//! The command side of `leaf open`: find a server already showing this path,
//! or start one detached and hand back its URL once it is listening.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::instances::{Instance, find_serving, read_instances, remove_instance};

pub const OPEN_IDLE_DEFAULT: &str = "10s";
/// The child tells the parent its URL through this file.
pub const READY_FILE_ENV: &str = "LEAF_READY_FILE";

const VALUE_FLAGS: &[&str] = &[
    "--host",
    "--port",
    "-l",
    "--log-level",
    "--log-format",
    "--plantuml-url",
    "--ignore",
    "--config-dir",
    "--idle-timeout",
];

/// The flags of an invocation, values included, without the command word, the target,
/// `--browser`, or `--open`/`--no-open`. The one place argv is forwarded from.
fn forwarded_flags(argv: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < argv.len() {
        let a = argv[i].as_str();
        if VALUE_FLAGS.contains(&a) {
            out.push(a.to_string());
            out.push(argv.get(i + 1).cloned().unwrap_or_default());
            i += 2;
            continue;
        }
        i += 1;
        if a.starts_with('-') && !matches!(a, "--browser" | "--open" | "--no-open") {
            out.push(a.to_string());
        }
    }
    out
}

/// The app process's argv for `leaf open`: the hidden `__app` command, the target, the flags.
pub fn app_args(argv: &[String], target: &Path) -> Vec<String> {
    let mut out = vec!["__app".to_string(), target.to_string_lossy().into_owned()];
    out.extend(forwarded_flags(argv));
    out
}

/// Whether a server started by this invocation opens a browser tab. `leaf serve` is a
/// server and opens one only when told to (`--open` or `LEAF_OPEN`); `leaf open --browser`
/// opens one unless told not to.
pub fn opens_browser(
    command: leaf_core::config::Command,
    open: bool,
    source: leaf_core::config::ConfigSource,
) -> bool {
    match command {
        leaf_core::config::Command::Serve => {
            open && source != leaf_core::config::ConfigSource::Default
        }
        _ => open,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Help,
    Version,
    Share,
    Serve,
    /// `leaf open`: start the app detached (or hand off to the running one) and return.
    LaunchApp,
    /// The app in this process: the detached child, or `leaf open -l …` watching its logs.
    AppForeground,
    /// `leaf open --browser`.
    Browser,
}

pub fn route(
    command: leaf_core::config::Command,
    as_app: bool,
    browser: bool,
    log_flag: bool,
) -> Route {
    use leaf_core::config::Command;
    match command {
        Command::Help => Route::Help,
        Command::Version => Route::Version,
        Command::Share => Route::Share,
        Command::Serve => Route::Serve,
        Command::Open if as_app => Route::AppForeground,
        Command::Open if browser => Route::Browser,
        Command::Open if log_flag => Route::AppForeground,
        Command::Open => Route::LaunchApp,
    }
}

/// The child's argv: the same flags, but `serve`, no browser, and an explicit idle timeout.
pub fn child_args(argv: &[String], target: &Path, idle_timeout: Option<&str>) -> Vec<String> {
    let mut out = vec!["serve".to_string(), target.to_string_lossy().into_owned()];
    out.extend(forwarded_flags(argv));
    out.push("--no-open".into());
    if let Some(idle) = idle_timeout
        && !argv.iter().any(|a| a == "--idle-timeout")
    {
        out.push("--idle-timeout".into());
        out.push(idle.to_string());
    }
    out
}

pub fn pid_alive(pid: u32) -> bool {
    // Signal 0 checks for existence without sending anything.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

pub async fn healthy(url: &str) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Some(rest) = url.strip_prefix("http://") else {
        return false;
    };
    let Ok(Ok(mut s)) = tokio::time::timeout(
        Duration::from_millis(1500),
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
    let _ = tokio::time::timeout(Duration::from_millis(1500), s.read_to_end(&mut buf)).await;
    String::from_utf8_lossy(&buf).ends_with("ok")
}

/// A live instance already serving `target`, with the URL to open; stale entries are dropped.
pub async fn find_running(config_dir: &Path, target: &Path) -> Option<(Instance, String)> {
    let mut live = Vec::new();
    for inst in read_instances(config_dir) {
        if pid_alive(inst.pid) && healthy(&inst.url).await {
            live.push(inst);
        } else {
            remove_instance(config_dir, inst.pid);
        }
    }
    let target = target.to_string_lossy();
    let (inst, path) = find_serving(&live, &target)?;
    let url = if path.is_empty() {
        inst.url.clone()
    } else {
        let encoded: Vec<String> = path.split('/').map(encode_segment).collect();
        format!("{}/{}", inst.url, encoded.join("/"))
    };
    Some((inst.clone(), url))
}

fn encode_segment(seg: &str) -> String {
    seg.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Keeps the app log bounded: past `max` bytes it moves to `<log>.1` (replacing the old one).
pub fn rotate_log(log: &Path, max: u64) {
    if std::fs::metadata(log).is_ok_and(|m| m.len() > max) {
        let _ = std::fs::rename(log, log.with_extension("log.1"));
    }
}

pub const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn log_file_for(config_dir: &Path) -> PathBuf {
    config_dir.join("logs").join("leaf.log")
}

/// Spawns `exe args` detached (its own process group, output to the log file) and waits for
/// the URL it writes to a ready file.
pub async fn launch_detached(
    exe: &Path,
    args: &[String],
    config_dir: &Path,
    timeout: Duration,
) -> Result<(String, u32), String> {
    use std::os::unix::process::CommandExt;
    let log_file = log_file_for(config_dir);
    std::fs::create_dir_all(log_file.parent().unwrap_or(config_dir)).map_err(|e| e.to_string())?;
    rotate_log(&log_file, LOG_MAX_BYTES);
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;
    let ready = std::env::temp_dir().join(format!(
        "leaf-ready-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    let mut child = Command::new(exe)
        .args(args)
        .env(READY_FILE_ENV, &ready)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .process_group(0)
        .spawn()
        .map_err(|e| format!("could not start the server: {e}"))?;
    let pid = child.id();
    let end = Instant::now() + timeout;
    loop {
        if let Ok(text) = std::fs::read_to_string(&ready) {
            let url = text.trim().to_string();
            if !url.is_empty() {
                let _ = std::fs::remove_file(&ready);
                return Ok((url, pid));
            }
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "server exited early ({status}); see {}",
                log_file.display()
            ));
        }
        if Instant::now() > end {
            let _ = child.kill();
            return Err(format!(
                "server did not start within {}s; see {}",
                timeout.as_secs(),
                log_file.display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// The UI route for a document path: `/` plus each segment URL-encoded, as the router builds it.
pub fn route_for(path: &str) -> String {
    let segments: Vec<String> = path
        .split('/')
        .filter(|s| !s.is_empty())
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect()
        })
        .collect();
    format!("/{}", segments.join("/"))
}

/// The target a `leaf __app <path> …` invocation names (the second launch's argv).
pub fn target_from_argv(argv: &[String], cwd: &Path) -> Option<PathBuf> {
    let mut it = argv.iter().skip_while(|a| *a != "__app").skip(1);
    let raw = it.find(|a| !a.starts_with('-'))?;
    let p = cwd.join(raw);
    p.canonicalize().ok()
}

/// Links the app window may hand to the system to open: web pages and mail only.
pub fn is_external_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    ["https://", "http://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme) && lower.len() > scheme.len())
}

#[cfg(test)]
mod external_url_tests {
    use super::is_external_url;

    #[test]
    fn web_and_mail_links_open_nothing_else_does() {
        assert!(is_external_url("https://github.com/rob/leaf/commit/abc"));
        assert!(is_external_url("HTTP://example.com"));
        assert!(is_external_url("mailto:a@b.c"));
        assert!(!is_external_url("https://"));
        assert!(!is_external_url("file:///etc/passwd"));
        assert!(!is_external_url("javascript:alert(1)"));
        assert!(!is_external_url("/Applications/Calculator.app"));
    }
}
