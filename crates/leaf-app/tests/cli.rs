// The `leaf` binary as a command: help, version, open-and-return, reuse, idle stop.
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

fn leaf(args: &[&str], env: &[(&str, &str)], cwd: &Path) -> (i32, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_leaf"))
        .args(args)
        .env_remove("LEAF_IDLE_TIMEOUT")
        .envs(env.iter().map(|(k, v)| (k.to_string(), v.to_string())))
        .current_dir(cwd)
        .output()
        .unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

async fn healthy(url: &str) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let Ok(Ok(mut s)) = tokio::time::timeout(
        Duration::from_millis(800),
        tokio::net::TcpStream::connect(rest),
    )
    .await
    else {
        return false;
    };
    if s.write_all(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .await
        .is_err()
    {
        return false;
    }
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_millis(800), s.read_to_end(&mut buf)).await;
    String::from_utf8_lossy(&buf).ends_with("ok")
}

async fn until(
    ms: u64,
    mut pred: impl FnMut() -> std::pin::Pin<Box<dyn std::future::Future<Output = bool>>>,
) -> bool {
    let end = Instant::now() + Duration::from_millis(ms);
    while Instant::now() < end {
        if pred().await {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    false
}

#[test]
fn help_and_version() {
    let d = tempfile::tempdir().unwrap();
    let (code, out, _) = leaf(&["--help"], &[], d.path());
    assert_eq!(code, 0);
    assert!(
        out.contains("leaf [open] [path]")
            && out.contains("leaf serve")
            && out.contains("LEAF_IDLE_TIMEOUT"),
        "{out}"
    );
    let (code, out, _) = leaf(&["--version"], &[], d.path());
    assert_eq!(code, 0);
    assert!(out.trim().starts_with(char::is_numeric), "{out}");
    let (code, _, err) = leaf(&["open", "nope-such-dir"], &[], d.path());
    assert_eq!(code, 2);
    assert!(err.contains("no such file or directory"), "{err}");
}

#[tokio::test]
async fn open_returns_reuses_and_stops_when_the_last_client_leaves() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("README.md"), "# hi\n").unwrap();
    let cfg = tempfile::tempdir().unwrap();
    let cfg_s = cfg.path().to_str().unwrap().to_string();
    let env: Vec<(&str, &str)> = vec![
        ("LEAF_CONFIG_DIR", &cfg_s),
        ("PORT", "0"),
        ("LEAF_IDLE_TIMEOUT", "1s"),
    ];
    let root_s = root.path().to_str().unwrap();

    let (code, out, err) = leaf(
        &["open", "--browser", root_s, "--no-open"],
        &env,
        root.path(),
    );
    assert_eq!((code, err.as_str()), (0, ""), "{out}{err}");
    let url = out.trim().to_string();
    assert!(url.starts_with("http://127.0.0.1:"), "{url}");
    assert!(healthy(&url).await, "server left running");
    let instances = std::fs::read_dir(cfg.path().join("instances"))
        .unwrap()
        .count();
    assert_eq!(instances, 1);
    assert!(cfg.path().join("logs").join("leaf.log").is_file());

    // A file inside the served folder: no second server, just the URL into the running one.
    let file = root.path().join("README.md");
    let (code, out, _) = leaf(
        &["open", "--browser", file.to_str().unwrap(), "--no-open"],
        &env,
        root.path(),
    );
    assert_eq!(code, 0);
    assert_eq!(out.trim(), format!("{url}/README.md"));
    assert_eq!(
        std::fs::read_dir(cfg.path().join("instances"))
            .unwrap()
            .count(),
        1
    );

    // A tab connects, then closes: the server goes away after the idle grace.
    let (mut ws, _) = tokio_tungstenite::connect_async(format!("{}/ws", url.replace("http", "ws")))
        .await
        .unwrap();
    ws.send(Message::Text(r#"{"type":"hello","protocol":1}"#.into()))
        .await
        .unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(3), ws.next()).await;
    ws.close(None).await.ok();
    drop(ws);
    let u = url.clone();
    assert!(
        until(15_000, move || {
            let u = u.clone();
            Box::pin(async move { !healthy(&u).await })
        })
        .await,
        "server did not stop"
    );
    let c = cfg.path().join("instances");
    assert!(
        until(5_000, move || {
            let c = c.clone();
            Box::pin(async move {
                std::fs::read_dir(&c)
                    .map(|d| d.count() == 0)
                    .unwrap_or(true)
            })
        })
        .await,
        "registry not cleaned"
    );
}

#[test]
fn a_second_launch_names_its_target() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("a.md"), "#").unwrap();
    let argv: Vec<String> = ["/bin/leaf", "__app", "a.md", "--no-open"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    assert_eq!(
        leaf_app::launch::target_from_argv(&argv, d.path()),
        Some(d.path().canonicalize().unwrap().join("a.md"))
    );
    assert_eq!(
        leaf_app::launch::target_from_argv(&["/bin/leaf".to_string()], d.path()),
        None
    );
}

#[test]
fn the_app_launch_keeps_flag_values_and_drops_the_browser_switch() {
    use std::path::Path;
    let argv: Vec<String> = [
        "open",
        "docs",
        "--plantuml-url",
        "http://x",
        "--config-dir",
        "/y",
        "--no-gitignore",
        "-l",
        "info",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        leaf_app::launch::app_args(&argv, Path::new("/abs/docs")),
        [
            "__app",
            "/abs/docs",
            "--plantuml-url",
            "http://x",
            "--config-dir",
            "/y",
            "--no-gitignore",
            "-l",
            "info"
        ]
    );
}

#[test]
fn routing_open_serve_browser_and_log_flag() {
    use leaf_app::launch::{Route, route};
    use leaf_core::config::Command;
    assert_eq!(route(Command::Open, false, false, false), Route::LaunchApp);
    assert_eq!(route(Command::Open, false, true, false), Route::Browser);
    // -l keeps the window and stays in the foreground with the logs on the terminal.
    assert_eq!(
        route(Command::Open, false, false, true),
        Route::AppForeground
    );
    assert_eq!(
        route(Command::Open, true, false, false),
        Route::AppForeground
    );
    assert_eq!(route(Command::Serve, false, false, false), Route::Serve);
    assert_eq!(route(Command::Help, false, false, false), Route::Help);
}

#[test]
fn the_first_route_is_url_encoded_per_segment() {
    assert_eq!(leaf_app::launch::route_for(""), "/");
    assert_eq!(
        leaf_app::launch::route_for("docs/notes #1.md"),
        "/docs/notes%20%231.md"
    );
    assert_eq!(leaf_app::launch::route_for("50%.md"), "/50%25.md");
}

#[test]
fn a_large_log_is_rotated_once() {
    let d = tempfile::tempdir().unwrap();
    let log = d.path().join("leaf.log");
    std::fs::write(&log, vec![b'x'; 6 * 1024 * 1024]).unwrap();
    leaf_app::launch::rotate_log(&log, 5 * 1024 * 1024);
    assert!(!log.exists() || std::fs::metadata(&log).unwrap().len() == 0);
    assert!(d.path().join("leaf.log.1").exists());
    std::fs::write(&log, b"small").unwrap();
    leaf_app::launch::rotate_log(&log, 5 * 1024 * 1024);
    assert_eq!(std::fs::read(&log).unwrap(), b"small");
}

#[test]
fn zero_address_is_not_a_loopback_host() {
    assert!(!leaf_app::http::host_allowed(Some("0.0.0.0:4321"), &[]));
    assert!(leaf_app::http::host_allowed(Some("127.0.0.1:4321"), &[]));
    assert!(leaf_app::http::host_allowed(Some("localhost"), &[]));
}

#[test]
fn serve_opens_a_browser_only_when_asked() {
    use leaf_app::launch::opens_browser;
    use leaf_core::config::{Command, ConfigSource};
    // `leaf serve` is a server: no tab unless --open (or LEAF_OPEN) says so.
    assert!(!opens_browser(Command::Serve, true, ConfigSource::Default));
    assert!(opens_browser(Command::Serve, true, ConfigSource::Flag));
    assert!(opens_browser(Command::Serve, true, ConfigSource::Env));
    assert!(!opens_browser(Command::Serve, false, ConfigSource::Flag));
    // `leaf open --browser` opens a tab by default.
    assert!(opens_browser(Command::Open, true, ConfigSource::Default));
    assert!(!opens_browser(Command::Open, false, ConfigSource::Flag));
}
