// The host side of sharing: a real relay in-process, a disk engine over a temp folder,
// and a `HostLink` sharing it; viewers are plain WebSockets and HTTP.
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use leaf_app::relay::{self, RelayOptions, RelayStarted};
use leaf_app::sharing::{self, HostOptions, LinkStatus, ShareHandle};
use leaf_core::engine::Engine;
use leaf_protocol::relay::ShareMode;
use leaf_protocol::{ClientMessage, PROTOCOL_VERSION};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const SECRET: &[u8] = b"test secret";
const WAIT: Duration = Duration::from_secs(5);

fn options(port: u16) -> RelayOptions {
    RelayOptions {
        grace: Duration::from_millis(500),
        ..RelayOptions::new("127.0.0.1".into(), port, SECRET.to_vec())
    }
}

/// A shared folder: README.md, pics/a.png (10 bytes), and secret.md hidden by .gitignore.
struct Folder {
    engine: Arc<Engine>,
    cfg: tempfile::TempDir,
    root: tempfile::TempDir,
    _watcher: Option<leaf_core::watch::Watcher>,
}

impl Folder {
    fn root(&self) -> std::path::PathBuf {
        self.root.path().canonicalize().unwrap()
    }
}

fn folder() -> Folder {
    let root = tempfile::tempdir().unwrap();
    let r = root.path().canonicalize().unwrap();
    std::fs::write(r.join("README.md"), "# shared\n").unwrap();
    std::fs::create_dir_all(r.join("pics")).unwrap();
    std::fs::write(r.join("pics/a.png"), b"0123456789").unwrap();
    std::fs::write(r.join(".gitignore"), "secret.md\n").unwrap();
    std::fs::write(r.join("secret.md"), "# secret\n").unwrap();
    let cfg = tempfile::tempdir().unwrap();
    let env: HashMap<String, String> = [(
        "LEAF_CONFIG_DIR".to_string(),
        cfg.path().to_string_lossy().into_owned(),
    )]
    .into();
    let argv = vec!["open".to_string(), r.to_string_lossy().into_owned()];
    let config = leaf_core::config::load(&argv, &env, &r).unwrap().0;
    let built = leaf_app::serve::build_engine(&config, Some(leaf_app::raw::RAW_BASE)).unwrap();
    Folder {
        engine: built.engine,
        cfg,
        root,
        _watcher: built.watcher,
    }
}

fn host_options(url: &str, engine: &Arc<Engine>) -> HostOptions {
    HostOptions {
        relay_url: url.to_string(),
        name: "Rob".into(),
        root: engine.source().root(),
        mode: ShareMode::ReadOnly,
        engine: engine.clone(),
        resume: None,
    }
}

async fn share(r: &RelayStarted, engine: &Arc<Engine>) -> ShareHandle {
    tokio::time::timeout(WAIT, sharing::start(host_options(&r.url, engine)))
        .await
        .expect("start in time")
        .expect("shared")
}

async fn connect(port: u16, path: &str) -> Ws {
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}{path}"))
        .await
        .expect("websocket connects");
    ws
}

/// The next text frame as JSON, or None when the socket closes.
async fn next_json(ws: &mut Ws) -> Option<Value> {
    loop {
        match tokio::time::timeout(WAIT, ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => return serde_json::from_str(&t).ok(),
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => return None,
            Ok(Some(Ok(_))) => continue,
            Err(_) => panic!("timed out waiting for a message"),
        }
    }
}

/// The next frame of type `ty`, skipping presence and the like.
async fn next_of(ws: &mut Ws, ty: &str) -> Value {
    loop {
        let v = next_json(ws)
            .await
            .unwrap_or_else(|| panic!("closed before {ty}"));
        if v["type"] == ty {
            return v;
        }
    }
}

async fn send(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
}

/// A viewer of `id` that has said hello and got its welcome.
async fn viewer(port: u16, id: &str) -> (Ws, Value) {
    let mut ws = connect(port, &format!("/s/{id}/ws")).await;
    let hello = ClientMessage::Hello {
        protocol: PROTOCOL_VERSION,
        name: Some("Ann".into()),
        id: Some("h".into()),
    };
    send(&mut ws, serde_json::to_value(&hello).unwrap()).await;
    let welcome = next_of(&mut ws, "welcome").await;
    (ws, welcome)
}

async fn read(ws: &mut Ws, path: &str, id: &str) -> Value {
    send(ws, json!({"type": "read", "path": path, "id": id})).await;
    loop {
        let v = next_json(ws).await.expect("a reply");
        if v["inReplyTo"] == id {
            return v;
        }
    }
}

/// Waits for the socket to close, skipping anything before.
async fn closes(ws: &mut Ws) {
    loop {
        match tokio::time::timeout(WAIT, ws.next()).await {
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) => return,
            Ok(Some(Ok(_))) => continue,
            Err(_) => panic!("socket did not close"),
        }
    }
}

/// GET over plain HTTP/1.1; the body de-chunked when it came chunked.
async fn http_get(port: u16, path: &str, extra: &str) -> (u16, Vec<u8>) {
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    s.write_all(
        format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra}Connection: close\r\n\r\n"
        )
        .as_bytes(),
    )
    .await
    .unwrap();
    let mut buf = Vec::new();
    tokio::time::timeout(WAIT, s.read_to_end(&mut buf))
        .await
        .expect("response in time")
        .unwrap();
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&buf[..split]).to_ascii_lowercase();
    let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
    let mut body = buf[split + 4..].to_vec();
    if head.contains("transfer-encoding: chunked") {
        let mut out = Vec::new();
        let mut rest = body.as_slice();
        loop {
            let eol = rest.windows(2).position(|w| w == b"\r\n").unwrap();
            let n = usize::from_str_radix(std::str::from_utf8(&rest[..eol]).unwrap().trim(), 16)
                .unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&rest[eol + 2..eol + 2 + n]);
            rest = &rest[eol + 2 + n + 2..];
        }
        body = out;
    }
    (status, body)
}

async fn status_becomes(handle: &ShareHandle, want: LinkStatus, within: Duration) {
    let mut rx = handle.status.clone();
    tokio::time::timeout(within, rx.wait_for(|s| *s == want))
        .await
        .unwrap_or_else(|_| panic!("status never became {want:?}"))
        .expect("status channel open");
}

#[tokio::test]
async fn a_shared_folder_is_readable_by_a_viewer() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let h = share(&r, &f.engine).await;
    assert_eq!(*h.status.borrow(), LinkStatus::Connected);
    assert!(
        h.web_url.ends_with(&format!("/s/{}", h.id)),
        "{}",
        h.web_url
    );

    let (mut v, welcome) = viewer(r.port, &h.id).await;
    assert_eq!(welcome["share"]["host"]["name"], "Rob");
    assert!(welcome.get("preferences").is_none(), "{welcome}");
    assert_eq!(welcome["root"]["name"], f.engine.source().root().name);

    let file = read(&mut v, "README.md", "r1").await;
    assert_eq!(file["type"], "file", "{file}");
    assert_eq!(file["content"], "# shared\n");

    let mut viewers = h.viewers.clone();
    tokio::time::timeout(
        WAIT,
        viewers.wait_for(|p| p.iter().any(|p| p.name == "Ann")),
    )
    .await
    .expect("the viewer shows")
    .unwrap();
    h.end();
    r.stop().await;
}

#[tokio::test]
async fn viewer_preferences_are_dropped() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let h = share(&r, &f.engine).await;
    let (mut v, _) = viewer(r.port, &h.id).await;

    send(
        &mut v,
        json!({"type": "preferences", "preferences": {"textPct": 300}, "id": "p"}),
    )
    .await;
    // Nothing answers the preferences, not even an error.
    let quiet = tokio::time::timeout(Duration::from_millis(300), async {
        loop {
            let v = next_json(&mut v).await;
            match v {
                Some(m) if m["type"] == "presence" || m["type"] == "shareStatus" => continue,
                other => return other,
            }
        }
    })
    .await;
    assert!(quiet.is_err(), "a reply came: {quiet:?}");
    assert!(
        !f.cfg.path().join("preferences.json").exists(),
        "the host's preferences were written"
    );

    // Anything else that isn't a read is refused out loud.
    send(
        &mut v,
        json!({"type": "write", "path": "README.md", "id": "w"}),
    )
    .await;
    let refused = loop {
        let m = next_json(&mut v).await.expect("a reply");
        if m["inReplyTo"] == "w" {
            break m;
        }
    };
    assert_eq!(refused["type"], "error");
    assert_eq!(refused["code"], "bad_request");
    assert_eq!(refused["message"], "not allowed in a shared tab");
    // ...and the viewer stays.
    assert_eq!(read(&mut v, "README.md", "r").await["type"], "file");
    h.end();
    r.stop().await;
}

#[tokio::test]
async fn a_path_outside_the_share_ends_the_viewer() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let h = share(&r, &f.engine).await;
    let before = f.engine.client_count();

    // SECRET.md: the same ignored file on a case-insensitive volume (macOS's default).
    let insensitive = f.root().join("SECRET.md").exists();
    let paths: &[&str] = if insensitive {
        &["../x.md", "secret.md", "SECRET.md"]
    } else {
        &["../x.md", "secret.md"]
    };
    for &path in paths {
        let (mut v, _) = viewer(r.port, &h.id).await;
        let err = read(&mut v, path, "x").await;
        assert_eq!(err["type"], "error", "{path}: {err}");
        let ended = next_of(&mut v, "shareStatus").await;
        assert_eq!(ended["state"], "ended", "{path}");
        assert_eq!(ended["reason"], "forbidden-path", "{path}");
        closes(&mut v).await;
    }
    // Their engine sessions are gone too.
    tokio::time::timeout(WAIT, async {
        while f.engine.client_count() != before {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("viewer sessions disconnected");
    h.end();
    r.stop().await;
}

#[tokio::test]
async fn a_raw_fetch_streams_from_disk() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let h = share(&r, &f.engine).await;
    let raw = format!("/s/{}/raw/pics/a.png", h.id);

    let (status, body) = http_get(r.port, &raw, "").await;
    assert_eq!((status, body.as_slice()), (200, &b"0123456789"[..]));
    let (status, body) = http_get(r.port, &raw, "Range: bytes=8-\r\n").await;
    assert_eq!((status, body.as_slice()), (206, &b"89"[..]));
    for name in ["secret.md", "SECRET.md", "Secret.MD"] {
        let (status, _) = http_get(r.port, &format!("/s/{}/raw/{name}", h.id), "").await;
        assert_eq!(status, 404, "ignored files aren't served: {name}");
    }
    let (status, _) = http_get(r.port, &format!("/s/{}/raw/nope.png", h.id), "").await;
    assert_eq!(status, 404);
    h.end();
    r.stop().await;
}

#[tokio::test]
async fn two_shares_on_one_engine_are_independent() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let a = share(&r, &f.engine).await;
    let b = share(&r, &f.engine).await;
    assert_ne!(a.id, b.id);

    let (mut va, _) = viewer(r.port, &a.id).await;
    let (mut vb, _) = viewer(r.port, &b.id).await;
    assert_eq!(read(&mut va, "README.md", "a1").await["type"], "file");

    a.end();
    let ended = next_of(&mut va, "shareStatus").await;
    assert_eq!(ended["state"], "ended");
    closes(&mut va).await;
    status_becomes(&a, LinkStatus::Ended, WAIT).await;

    assert_eq!(read(&mut vb, "README.md", "b1").await["type"], "file");
    b.end();
    r.stop().await;
}

#[tokio::test]
async fn the_host_reconnects_and_keeps_its_id() {
    let f = folder();
    let r = relay::start(options(0)).await.unwrap();
    let port = r.port;
    let url = r.url.clone();
    let h = share(&r, &f.engine).await;
    let before = f.engine.client_count();
    // A viewer that won't come back: the restarted relay forgets it.
    let (_gone, _) = viewer(r.port, &h.id).await;
    let mut viewers = h.viewers.clone();
    tokio::time::timeout(WAIT, viewers.wait_for(|p| p.len() == 1))
        .await
        .expect("the viewer shows")
        .unwrap();
    assert_eq!(f.engine.client_count(), before + 1);

    r.stop().await;
    status_becomes(&h, LinkStatus::Reconnecting, WAIT).await;
    let r = relay::start(options(port)).await.unwrap();
    assert_eq!(r.url, url);
    status_becomes(&h, LinkStatus::Connected, Duration::from_secs(3)).await;
    tokio::time::timeout(WAIT, viewers.wait_for(|p| p.is_empty()))
        .await
        .expect("the forgotten viewer is dropped")
        .unwrap();
    assert_eq!(
        f.engine.client_count(),
        before,
        "its engine session is gone"
    );

    let (mut v, welcome) = viewer(r.port, &h.id).await;
    assert_eq!(welcome["share"]["id"], h.id);
    assert_eq!(read(&mut v, "README.md", "r").await["type"], "file");
    h.end();
    r.stop().await;
}

#[test]
fn allowed_lists_what_read_only_permits() {
    for ty in [
        "hello",
        "list",
        "read",
        "subscribe",
        "unsubscribe",
        "search",
        "searchText",
        "blame",
    ] {
        assert!(
            sharing::allowed(&json!({"type": ty}), ShareMode::ReadOnly),
            "{ty}"
        );
    }
    for ty in ["preferences", "write", "nonsense"] {
        assert!(
            !sharing::allowed(&json!({"type": ty}), ShareMode::ReadOnly),
            "{ty}"
        );
    }
    assert!(!sharing::allowed(&json!({}), ShareMode::ReadOnly));
}

#[test]
fn the_host_is_named_from_the_environment() {
    let env = |pairs: &[(&str, &str)]| -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    };
    assert_eq!(
        sharing::host_name(&env(&[("LEAF_NAME", "Rob"), ("USER", "rob")])),
        "Rob"
    );
    assert_eq!(sharing::host_name(&env(&[("USER", "rob")])), "rob");
    assert_eq!(sharing::host_name(&env(&[("LOGNAME", "rh")])), "rh");
    assert_eq!(sharing::host_name(&env(&[("LEAF_NAME", "  ")])), "Host");
    assert_eq!(sharing::host_name(&env(&[])), "Host");
}
