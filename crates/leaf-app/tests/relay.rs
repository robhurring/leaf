// The relay end to end: hosts share, viewers join, presence, grace, resume, limits.
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use leaf_app::relay::{self, RelayOptions, RelayStarted, hostkey, words};
use leaf_protocol::relay::{HostToRelay, RELAY_PROTOCOL, RelayToHost, Resume, ShareMode};
use leaf_protocol::{
    ClientMessage, EntryKind, PROTOCOL_VERSION, RootInfo, ServerMessage, ShareState,
};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const SECRET: &[u8] = b"test secret";
const PUBLIC: &str = "https://relay.test";
const WAIT: Duration = Duration::from_secs(5);

fn options() -> RelayOptions {
    RelayOptions {
        public_url: Some(PUBLIC.into()),
        grace: Duration::from_millis(500),
        ..RelayOptions::new("127.0.0.1".into(), 0, SECRET.to_vec())
    }
}

async fn start_with(opts: RelayOptions) -> RelayStarted {
    relay::start(opts).await.expect("relay starts")
}

async fn start_relay() -> RelayStarted {
    start_with(options()).await
}

fn text<T: serde::Serialize>(m: &T) -> Message {
    Message::Text(serde_json::to_string(m).unwrap().into())
}

fn share_msg(protocol: u8, resume: Option<Resume>) -> HostToRelay {
    HostToRelay::Share {
        protocol,
        relay_protocol: RELAY_PROTOCOL,
        name: "Rob".into(),
        root: RootInfo {
            kind: EntryKind::Dir,
            name: "docs".into(),
        },
        mode: ShareMode::ReadOnly,
        resume,
    }
}

async fn connect(port: u16, path: &str) -> Ws {
    let (ws, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}{path}"))
        .await
        .expect("websocket connects");
    ws
}

/// The next text frame as JSON, or None when the socket closes or nothing comes.
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

async fn next_host(ws: &mut Ws) -> RelayToHost {
    let v = next_json(ws).await.expect("a host message");
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{v}: {e}"))
}

/// The next text frame whose `type` is `ty`, skipping others.
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

/// Waits for the socket to close; returns the close code if one was sent.
async fn closed(ws: &mut Ws) -> Option<CloseCode> {
    loop {
        match tokio::time::timeout(WAIT, ws.next()).await {
            Ok(Some(Ok(Message::Close(frame)))) => return frame.map(|f| f.code),
            Ok(None) | Ok(Some(Err(_))) => return None,
            Ok(Some(Ok(_))) => continue,
            Err(_) => panic!("socket did not close"),
        }
    }
}

async fn host_share(port: u16) -> (Ws, RelayToHost) {
    let mut ws = connect(port, "/host").await;
    ws.send(text(&share_msg(PROTOCOL_VERSION, None)))
        .await
        .unwrap();
    let shared = next_host(&mut ws).await;
    assert!(matches!(shared, RelayToHost::Shared { .. }), "{shared:?}");
    (ws, shared)
}

fn id_of(shared: &RelayToHost) -> String {
    match shared {
        RelayToHost::Shared { id, .. } => id.clone(),
        other => panic!("not shared: {other:?}"),
    }
}

async fn viewer(port: u16, id: &str) -> Ws {
    connect(port, &format!("/s/{id}/ws")).await
}

async fn hello(ws: &mut Ws, name: Option<&str>) {
    ws.send(text(&ClientMessage::Hello {
        protocol: PROTOCOL_VERSION,
        name: name.map(str::to_string),
        id: Some("h".into()),
    }))
    .await
    .unwrap();
}

/// A viewer that has said hello, with the host having seen Joined and the hello.
async fn joined_viewer(port: u16, id: &str, host: &mut Ws, name: &str) -> (Ws, String) {
    let mut v = viewer(port, id).await;
    hello(&mut v, Some(name)).await;
    let vid = match next_host(host).await {
        RelayToHost::Joined { viewer, .. } => viewer,
        other => panic!("expected joined: {other:?}"),
    };
    assert!(matches!(
        next_host(host).await,
        RelayToHost::FromViewer { .. }
    ));
    (v, vid)
}

async fn http_get(port: u16, path: &str) -> (u16, String) {
    http_get_with(port, path, "").await
}

/// `extra` is raw header lines, each ending in "\r\n".
async fn http_get_with(port: u16, path: &str, extra: &str) -> (u16, String) {
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
    s.read_to_end(&mut buf).await.unwrap();
    let all = String::from_utf8_lossy(&buf).into_owned();
    let status = all.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = all.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
    (status, body.to_string())
}

#[tokio::test]
async fn a_host_gets_an_id_and_urls() {
    let r = start_relay().await;
    let (_host, shared) = host_share(r.port).await;
    let RelayToHost::Shared {
        id,
        host_key,
        web_url,
        app_url,
    } = shared
    else {
        unreachable!()
    };
    assert!(words::is_id(&id), "{id}");
    assert_eq!(web_url, format!("https://relay.test/s/{id}"));
    assert_eq!(app_url, format!("leaf://relay/relay.test/s/{id}"));
    assert!(hostkey::verify(SECRET, &id, &host_key));
    assert_eq!(
        relay::urls("http://r.test:8080", "a-b-c"),
        (
            "http://r.test:8080/s/a-b-c".to_string(),
            "leaf://relay/r.test:8080/s/a-b-c".to_string()
        )
    );
    r.stop().await;
}

#[tokio::test]
async fn the_relay_serves_the_page_and_share_health() {
    let r = start_relay().await;
    let (_host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    assert_eq!(http_get(r.port, "/healthz").await, (200, "ok".into()));
    assert_eq!(
        http_get(r.port, &format!("/s/{id}/healthz")).await,
        (200, "ok".into())
    );
    assert_eq!(http_get(r.port, "/s/aaa-bbb-ccc/healthz").await.0, 404);
    for path in [format!("/s/{id}"), format!("/s/{id}/docs/guide.md")] {
        let (status, body) = http_get(r.port, &path).await;
        assert_eq!(status, 200, "{path}");
        assert!(body.contains("id=\"root\""), "{path} serves the page");
    }
    assert_eq!(http_get(r.port, "/s/aaa-bbb-ccc/raw/a.png").await.0, 404);
    r.stop().await;
}

#[tokio::test]
async fn a_viewer_hello_reaches_the_host_and_welcome_comes_back_patched() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let mut v = viewer(r.port, &id).await;
    hello(&mut v, None).await;

    let RelayToHost::Joined {
        viewer: vid, name, ..
    } = next_host(&mut host).await
    else {
        panic!("expected joined")
    };
    let parts: Vec<&str> = name.split(' ').collect();
    assert_eq!(parts.len(), 2, "{name}");
    for p in parts {
        let lower = p.to_lowercase();
        assert!(words::WORDS.contains(&lower.as_str()), "{name}");
        assert!(p.chars().next().unwrap().is_uppercase(), "{name}");
    }
    match next_host(&mut host).await {
        RelayToHost::FromViewer { viewer, msg } => {
            assert_eq!(viewer, vid);
            assert_eq!(msg["type"], "hello");
        }
        other => panic!("expected the hello: {other:?}"),
    }

    let welcome = json!({
        "type": "welcome",
        "protocol": PROTOCOL_VERSION,
        "root": {"kind": "dir", "name": "docs"},
        "config": {},
        "capabilities": {"watch": true, "write": false, "collaborate": false, "rawUrls": false},
        "participant": {"id": vid, "name": name},
        "preferences": {"theme": "paper"},
        "inReplyTo": "h",
    });
    host.send(text(&HostToRelay::ToViewer {
        viewer: vid.clone(),
        msg: welcome,
    }))
    .await
    .unwrap();

    let (mut got_welcome, mut got_presence) = (None, None);
    while got_welcome.is_none() || got_presence.is_none() {
        let m = next_json(&mut v).await.expect("viewer message");
        match m["type"].as_str() {
            Some("welcome") => got_welcome = Some(m),
            Some("presence") => got_presence = Some(m),
            _ => {}
        }
    }
    let w = got_welcome.unwrap();
    assert!(w.get("preferences").is_none(), "{w}");
    assert_eq!(w["capabilities"]["rawUrls"], true);
    assert_eq!(
        w["capabilities"]["rawBase"],
        format!("https://relay.test/s/{id}/raw/")
    );
    match serde_json::from_value::<ServerMessage>(w).unwrap() {
        ServerMessage::Welcome {
            share: Some(share), ..
        } => {
            assert_eq!(share.id, id);
            assert_eq!(share.host.name, "Rob");
            assert_eq!(share.host.id, "host");
            assert_eq!(share.web_url, format!("https://relay.test/s/{id}"));
        }
        other => panic!("{other:?}"),
    }
    match serde_json::from_value::<ServerMessage>(got_presence.unwrap()).unwrap() {
        ServerMessage::Presence {
            you, viewers, host, ..
        } => {
            assert_eq!(you, vid);
            assert_eq!(viewers.len(), 1);
            assert_eq!(viewers[0].id, vid);
            assert_eq!(host.name, "Rob");
        }
        other => panic!("{other:?}"),
    }
    r.stop().await;
}

#[tokio::test]
async fn a_named_viewer_keeps_its_name() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let mut v = viewer(r.port, &id_of(&shared)).await;
    hello(&mut v, Some("Ann")).await;
    match next_host(&mut host).await {
        RelayToHost::Joined { name, color, .. } => {
            assert_eq!(name, "Ann");
            assert_eq!(color, relay::share::color_for("Ann"));
        }
        other => panic!("{other:?}"),
    }
    r.stop().await;
}

#[tokio::test]
async fn an_unknown_share_closes_and_too_many_tries_are_refused() {
    let r = start_relay().await;
    let url = format!("ws://127.0.0.1:{}/s/aaa-bbb-ccc/ws", r.port);
    for _ in 0..10 {
        let (mut ws, _) = tokio_tungstenite::connect_async(&url)
            .await
            .expect("the upgrade succeeds, then closes");
        assert_eq!(closed(&mut ws).await, Some(CloseCode::from(4404)));
    }
    match tokio_tungstenite::connect_async(&url).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => {
            assert_eq!(resp.status().as_u16(), 429)
        }
        Err(e) => panic!("expected 429, got {e}"),
        Ok(_) => panic!("expected 429, got an upgrade"),
    }
    r.stop().await;
}

#[tokio::test]
async fn a_version_mismatch_is_told_plainly() {
    let r = start_relay().await;
    let mut h = connect(r.port, "/host").await;
    h.send(text(&share_msg(99, None))).await.unwrap();
    match next_host(&mut h).await {
        RelayToHost::Error { code, message } => {
            assert_eq!(code, "version");
            assert!(message.contains("update leaf"), "{message}");
        }
        other => panic!("{other:?}"),
    }
    assert!(next_json(&mut h).await.is_none(), "closed");

    let (_host, shared) = host_share(r.port).await;
    let mut v = viewer(r.port, &id_of(&shared)).await;
    v.send(Message::Text(r#"{"type":"hello","protocol":99}"#.into()))
        .await
        .unwrap();
    let e = next_json(&mut v).await.expect("an error");
    assert_eq!(e["type"], "error");
    assert!(e["message"].as_str().unwrap().contains("reload"), "{e}");
    assert!(next_json(&mut v).await.is_none(), "closed");
    r.stop().await;
}

#[tokio::test]
async fn the_host_can_expel_one_viewer() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (mut v1, id1) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    let (mut v2, id2) = joined_viewer(r.port, &id, &mut host, "Bea").await;
    assert_eq!((id1.as_str(), id2.as_str()), ("v1", "v2"));

    host.send(text(&HostToRelay::ToViewer {
        viewer: id1.clone(),
        msg: json!({"type": "shareStatus", "state": "ended", "reason": "forbidden-path"}),
    }))
    .await
    .unwrap();
    let s = next_of(&mut v1, "shareStatus").await;
    assert_eq!(
        (s["state"].as_str(), s["reason"].as_str()),
        (Some("ended"), Some("forbidden-path"))
    );
    closed(&mut v1).await;
    match next_host(&mut host).await {
        RelayToHost::Left { viewer } => assert_eq!(viewer, id1),
        other => panic!("{other:?}"),
    }

    // v2 is still here: it sees presence with only itself, and its messages reach the host.
    loop {
        let p = next_of(&mut v2, "presence").await;
        if p["viewers"].as_array().unwrap().len() == 1 {
            assert_eq!(p["viewers"][0]["id"], id2.as_str());
            break;
        }
    }
    v2.send(Message::Text(r#"{"type":"list","id":"l"}"#.into()))
        .await
        .unwrap();
    match next_host(&mut host).await {
        RelayToHost::FromViewer { viewer, msg } => {
            assert_eq!(viewer, id2);
            assert_eq!(msg["type"], "list");
        }
        other => panic!("{other:?}"),
    }
    r.stop().await;
}

#[tokio::test]
async fn ending_tells_viewers_and_frees_the_id() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (mut v, _) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    host.send(text(&HostToRelay::End)).await.unwrap();
    let s: ServerMessage = serde_json::from_value(next_of(&mut v, "shareStatus").await).unwrap();
    assert!(
        matches!(&s, ServerMessage::ShareStatus { state: ShareState::Ended, reason: Some(r), .. } if r == "host"),
        "{s:?}"
    );
    closed(&mut v).await;
    let mut late = viewer(r.port, &id).await;
    assert_eq!(closed(&mut late).await, Some(CloseCode::from(4404)));
    r.stop().await;
}

#[tokio::test]
async fn a_dropped_host_gets_grace_then_the_share_ends() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (mut v, _) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    drop(host);
    let s = next_of(&mut v, "shareStatus").await;
    assert_eq!(s["state"], "reconnecting");
    assert_eq!(
        http_get(r.port, &format!("/s/{id}/healthz")).await.0,
        200,
        "a share in grace is still there"
    );
    let s = next_of(&mut v, "shareStatus").await;
    assert_eq!(
        (s["state"].as_str(), s["reason"].as_str()),
        (Some("ended"), Some("host-gone"))
    );
    closed(&mut v).await;
    assert_eq!(http_get(r.port, &format!("/s/{id}/healthz")).await.0, 404);
    r.stop().await;
}

#[tokio::test]
async fn a_host_resumes_within_grace_with_its_key_and_buffered_messages_replay() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let RelayToHost::Shared { id, host_key, .. } = shared.clone() else {
        unreachable!()
    };
    let (mut v, vid) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    drop(host);
    assert_eq!(
        next_of(&mut v, "shareStatus").await["state"],
        "reconnecting"
    );
    v.send(Message::Text(
        r#"{"type":"read","path":"a.md","id":"r"}"#.into(),
    ))
    .await
    .unwrap();

    // A wrong key is refused.
    let mut bad = connect(r.port, "/host").await;
    bad.send(text(&share_msg(
        PROTOCOL_VERSION,
        Some(Resume {
            id: id.clone(),
            host_key: hostkey::host_key(b"wrong", &id),
        }),
    )))
    .await
    .unwrap();
    assert!(
        matches!(next_host(&mut bad).await, RelayToHost::Error { code, .. } if code == "bad-key")
    );

    let mut host = connect(r.port, "/host").await;
    host.send(text(&share_msg(
        PROTOCOL_VERSION,
        Some(Resume {
            id: id.clone(),
            host_key: host_key.clone(),
        }),
    )))
    .await
    .unwrap();
    assert!(matches!(next_host(&mut host).await, RelayToHost::Shared { id: got, .. } if got == id));
    match next_host(&mut host).await {
        RelayToHost::FromViewer { viewer, msg } => {
            assert_eq!(viewer, vid);
            assert_eq!(msg["type"], "read");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(next_of(&mut v, "shareStatus").await["state"], "live");
    next_of(&mut v, "presence").await;

    // A second host can't take a live share, even with the key.
    let mut thief = connect(r.port, "/host").await;
    thief
        .send(text(&share_msg(
            PROTOCOL_VERSION,
            Some(Resume {
                id: id.clone(),
                host_key,
            }),
        )))
        .await
        .unwrap();
    assert!(
        matches!(next_host(&mut thief).await, RelayToHost::Error { code, .. } if code == "bad-key")
    );

    // The grace timer was cancelled: well past the grace period the share is still live.
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert_eq!(http_get(r.port, &format!("/s/{id}/healthz")).await.0, 200);
    r.stop().await;
}

#[tokio::test]
async fn a_restarted_relay_accepts_the_same_host_key() {
    let r = start_relay().await;
    let (_host, shared) = host_share(r.port).await;
    let RelayToHost::Shared { id, host_key, .. } = shared else {
        unreachable!()
    };
    r.stop().await;

    let r = start_relay().await;
    let mut host = connect(r.port, "/host").await;
    host.send(text(&share_msg(
        PROTOCOL_VERSION,
        Some(Resume {
            id: id.clone(),
            host_key,
        }),
    )))
    .await
    .unwrap();
    assert!(matches!(next_host(&mut host).await, RelayToHost::Shared { id: got, .. } if got == id));
    r.stop().await;
}

#[tokio::test]
async fn too_many_viewers_are_refused() {
    let r = start_with(RelayOptions {
        max_viewers: 2,
        ..options()
    })
    .await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (_v1, _) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    let (_v2, _) = joined_viewer(r.port, &id, &mut host, "Bea").await;
    let mut v3 = viewer(r.port, &id).await;
    hello(&mut v3, Some("Cal")).await;
    let e = next_json(&mut v3).await.expect("an error");
    assert_eq!(e["type"], "error");
    assert_eq!(e["code"], "bad_request");
    assert_eq!(e["message"], "this share is full");
    assert!(next_json(&mut v3).await.is_none(), "closed");
    r.stop().await;
}

#[tokio::test]
async fn a_socket_that_says_nothing_is_closed() {
    let r = start_with(RelayOptions {
        first_frame_timeout: Duration::from_millis(200),
        ..options()
    })
    .await;
    let mut silent_host = connect(r.port, "/host").await;
    closed(&mut silent_host).await;

    let (_host, shared) = host_share(r.port).await;
    let mut silent_viewer = viewer(r.port, &id_of(&shared)).await;
    closed(&mut silent_viewer).await;
    r.stop().await;
}

#[tokio::test]
async fn an_oversized_viewer_message_closes_it() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let (mut v, vid) = joined_viewer(r.port, &id_of(&shared), &mut host, "Ann").await;
    let big = format!(
        r#"{{"type":"read","path":"{}"}}"#,
        "a".repeat(relay::MAX_VIEWER_FRAME)
    );
    let _ = v.send(Message::Text(big.into())).await;
    closed(&mut v).await;
    match next_host(&mut host).await {
        RelayToHost::Left { viewer } => assert_eq!(viewer, vid),
        other => panic!("the big message must not reach the host: {other:?}"),
    }
    r.stop().await;
}

#[tokio::test]
async fn share_health_counts_unknown_ids_against_the_asker() {
    let r = start_relay().await;
    for _ in 0..10 {
        assert_eq!(http_get(r.port, "/s/aaa-bbb-ccc/healthz").await.0, 404);
    }
    assert_eq!(http_get(r.port, "/s/aaa-bbb-ccc/healthz").await.0, 429);
    // The same counter guards viewer joins.
    match tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{}/s/aaa-bbb-ccc/ws", r.port))
        .await
    {
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => {
            assert_eq!(resp.status().as_u16(), 429)
        }
        other => panic!("expected 429: {:?}", other.map(|_| ())),
    }
    r.stop().await;
}

#[tokio::test]
async fn a_spoofed_forwarded_for_is_ignored_unless_the_proxy_is_trusted() {
    // Not trusted: every miss counts against the peer, whatever the header claims.
    let r = start_relay().await;
    for i in 0..10 {
        let xff = format!("X-Forwarded-For: 10.0.0.{i}\r\n");
        assert_eq!(
            http_get_with(r.port, "/s/aaa-bbb-ccc/healthz", &xff)
                .await
                .0,
            404
        );
    }
    let xff = "X-Forwarded-For: 10.0.0.99\r\n";
    assert_eq!(
        http_get_with(r.port, "/s/aaa-bbb-ccc/healthz", xff).await.0,
        429
    );
    r.stop().await;

    // Trusted: the last hop (the proxy's own) is the address; earlier hops are ignored.
    let r = start_with(RelayOptions {
        trust_proxy: true,
        ..options()
    })
    .await;
    for i in 0..10 {
        let xff = format!("X-Forwarded-For: 192.0.2.{i}, 10.0.0.1\r\n");
        assert_eq!(
            http_get_with(r.port, "/s/aaa-bbb-ccc/healthz", &xff)
                .await
                .0,
            404
        );
    }
    let blocked = "X-Forwarded-For: 192.0.2.200, 10.0.0.1\r\n";
    assert_eq!(
        http_get_with(r.port, "/s/aaa-bbb-ccc/healthz", blocked)
            .await
            .0,
        429
    );
    let other = "X-Forwarded-For: 10.0.0.1, 10.0.0.2\r\n";
    assert_eq!(
        http_get_with(r.port, "/s/aaa-bbb-ccc/healthz", other)
            .await
            .0,
        404,
        "a different last hop is a different client"
    );
    assert_eq!(
        http_get(r.port, "/s/aaa-bbb-ccc/healthz").await.0,
        404,
        "no header: the peer, which has no misses of its own"
    );
    r.stop().await;
}

/// A response as an HTTP/1.1 client reads it: status, headers, and the body with any
/// chunked framing taken off.
struct HttpReply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpReply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

async fn http_reply(port: u16, path: &str, extra: &str) -> HttpReply {
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
        .expect("a response")
        .unwrap();
    let split = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .expect("a head");
    let head = String::from_utf8_lossy(&buf[..split]).into_owned();
    let mut lines = head.split("\r\n");
    let status = lines.next().unwrap().split_whitespace().nth(1).unwrap();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    let mut rest = &buf[split + 4..];
    let chunked = headers
        .iter()
        .any(|(k, v)| k.eq_ignore_ascii_case("transfer-encoding") && v.contains("chunked"));
    let body = if chunked {
        let mut body = Vec::new();
        loop {
            let eol = rest.windows(2).position(|w| w == b"\r\n").unwrap();
            let size =
                usize::from_str_radix(std::str::from_utf8(&rest[..eol]).unwrap(), 16).unwrap();
            rest = &rest[eol + 2..];
            if size == 0 {
                break body;
            }
            body.extend_from_slice(&rest[..size]);
            rest = &rest[size + 2..];
        }
    } else {
        rest.to_vec()
    };
    HttpReply {
        status: status.parse().unwrap(),
        headers,
        body,
    }
}

fn chunk(req: u32, bytes: &[u8]) -> Message {
    let mut frame = req.to_be_bytes().to_vec();
    frame.extend_from_slice(bytes);
    Message::Binary(frame.into())
}

#[tokio::test]
async fn a_raw_request_is_served_by_the_host_in_frames() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let port = r.port;
    let path = format!("/s/{id}/raw/pics/a.png");
    let get = tokio::spawn(async move { http_reply(port, &path, "Range: bytes=0-5\r\n").await });
    let req = match next_host(&mut host).await {
        RelayToHost::Fetch { req, path, range } => {
            assert_eq!(path, "pics/a.png");
            assert_eq!(range.as_deref(), Some("bytes=0-5"));
            req
        }
        other => panic!("expected fetch: {other:?}"),
    };
    host.send(text(&HostToRelay::Fetched {
        req,
        status: 206,
        headers: vec![
            ("Content-Type".into(), "image/png".into()),
            ("Content-Range".into(), "bytes 0-5/10".into()),
        ],
    }))
    .await
    .unwrap();
    for bytes in [&b"012"[..], b"345", b""] {
        host.send(chunk(req, bytes)).await.unwrap();
    }
    let reply = get.await.unwrap();
    assert_eq!(reply.status, 206);
    assert_eq!(reply.header("content-type"), Some("image/png"));
    assert_eq!(reply.header("content-range"), Some("bytes 0-5/10"));
    assert_eq!(reply.body, b"012345");
    r.stop().await;
}

#[tokio::test]
async fn a_viewer_gone_mid_fetch_cancels_it() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", r.port))
        .await
        .unwrap();
    s.write_all(
        format!(
            "GET /s/{id}/raw/clip.mp4 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\r\n",
            r.port
        )
        .as_bytes(),
    )
    .await
    .unwrap();
    let RelayToHost::Fetch { req, .. } = next_host(&mut host).await else {
        panic!("expected fetch")
    };
    drop(s);
    let cancel = tokio::time::timeout(Duration::from_secs(1), next_host(&mut host))
        .await
        .expect("cancel within 1 s");
    assert_eq!(cancel, RelayToHost::Cancel { req });
    // The cancelled fetch's tail is dropped quietly; the link carries on.
    host.send(chunk(req, b"late")).await.unwrap();
    assert_eq!(
        http_get(r.port, &format!("/s/{id}/healthz")).await,
        (200, "ok".into())
    );
    r.stop().await;
}

#[tokio::test]
async fn raw_on_a_share_in_grace_says_retry() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (mut v, _) = joined_viewer(r.port, &id, &mut host, "Ann").await;
    drop(host);
    assert_eq!(
        next_of(&mut v, "shareStatus").await["state"],
        "reconnecting"
    );
    let reply = http_reply(r.port, &format!("/s/{id}/raw/a.png"), "").await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.header("retry-after"), Some("5"));
    r.stop().await;
}

/// A host whose messages arrive on a channel, so the test can send while it listens.
fn split_host(
    host: Ws,
) -> (
    futures_util::stream::SplitSink<Ws, Message>,
    tokio::sync::mpsc::UnboundedReceiver<RelayToHost>,
) {
    let (sink, mut stream) = host.split();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Some(Ok(m)) = stream.next().await {
            if let Message::Text(t) = m
                && let Ok(msg) = serde_json::from_str::<RelayToHost>(&t)
                && tx.send(msg).is_err()
            {
                break;
            }
        }
    });
    (sink, rx)
}

async fn next_from(rx: &mut tokio::sync::mpsc::UnboundedReceiver<RelayToHost>) -> RelayToHost {
    loop {
        match tokio::time::timeout(WAIT, rx.recv()).await {
            Ok(Some(RelayToHost::Ping)) => continue,
            Ok(Some(m)) => return m,
            Ok(None) => panic!("host link closed"),
            Err(_) => panic!("timed out waiting for a host message"),
        }
    }
}

async fn fetch_req(host: &mut Ws) -> u32 {
    match next_host(host).await {
        RelayToHost::Fetch { req, .. } => req,
        other => panic!("expected fetch: {other:?}"),
    }
}

#[tokio::test]
async fn a_resumed_host_ends_the_old_fetches_and_takes_new_ones() {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let RelayToHost::Shared { id, host_key, .. } = shared else {
        unreachable!()
    };
    let port = r.port;
    let path = format!("/s/{id}/raw/a.png");
    let pending = tokio::spawn(async move { http_reply(port, &path, "").await });
    fetch_req(&mut host).await;
    drop(host);
    let failed = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .expect("the waiting fetch fails promptly, not after the head timeout")
        .unwrap();
    assert_eq!(failed.status, 502);

    let mut host = connect(r.port, "/host").await;
    host.send(text(&share_msg(
        PROTOCOL_VERSION,
        Some(Resume {
            id: id.clone(),
            host_key,
        }),
    )))
    .await
    .unwrap();
    assert!(matches!(
        next_host(&mut host).await,
        RelayToHost::Shared { .. }
    ));
    let path = format!("/s/{id}/raw/b.png");
    let get = tokio::spawn(async move { http_reply(port, &path, "").await });
    let req = fetch_req(&mut host).await;
    host.send(text(&HostToRelay::Fetched {
        req,
        status: 200,
        headers: vec![("Content-Type".into(), "image/png".into())],
    }))
    .await
    .unwrap();
    host.send(chunk(req, b"png")).await.unwrap();
    host.send(chunk(req, b"")).await.unwrap();
    let reply = get.await.unwrap();
    assert_eq!((reply.status, reply.body.as_slice()), (200, &b"png"[..]));
    r.stop().await;
}

/// The host answers one fetch for `path` with `headers` and an empty body.
async fn served_with(path: &str, headers: Vec<(String, String)>) -> HttpReply {
    let r = start_relay().await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let port = r.port;
    let url = format!("/s/{id}/raw/{path}");
    let get = tokio::spawn(async move { http_reply(port, &url, "").await });
    let req = fetch_req(&mut host).await;
    host.send(text(&HostToRelay::Fetched {
        req,
        status: 200,
        headers,
    }))
    .await
    .unwrap();
    host.send(chunk(req, b"")).await.unwrap();
    let reply = get.await.unwrap();
    r.stop().await;
    reply
}

#[tokio::test]
async fn raw_responses_are_never_sniffed_and_script_is_sandboxed() {
    // HTML the host labels plainly, with no protection of its own.
    let reply = served_with(
        "notes.txt",
        vec![("Content-Type".into(), "text/html".into())],
    )
    .await;
    assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(reply.header("content-security-policy"), Some("sandbox"));
    // A scriptable path is sandboxed whatever the host calls it; the host's own
    // values for these two headers are not used.
    let reply = served_with(
        "page.svg",
        vec![
            ("Content-Type".into(), "image/png".into()),
            ("Content-Security-Policy".into(), "script-src *".into()),
            ("X-Content-Type-Options".into(), "sniff-away".into()),
        ],
    )
    .await;
    assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(reply.header("content-security-policy"), Some("sandbox"));
    // A plain image keeps no host CSP and needs none.
    let reply = served_with(
        "a.png",
        vec![
            ("Content-Type".into(), "image/png".into()),
            ("Content-Security-Policy".into(), "script-src *".into()),
        ],
    )
    .await;
    assert_eq!(reply.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(reply.header("content-security-policy"), None);
}

#[tokio::test]
async fn a_viewer_that_stops_reading_pauses_the_host_then_resumes_it() {
    let r = start_relay().await;
    let (host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let (mut sink, mut from_relay) = split_host(host);
    let mut client = tokio::net::TcpStream::connect(("127.0.0.1", r.port))
        .await
        .unwrap();
    client
        .write_all(
            format!(
                "GET /s/{id}/raw/clip.mp4 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
                r.port
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let req = match next_from(&mut from_relay).await {
        RelayToHost::Fetch { req, .. } => req,
        other => panic!("expected fetch: {other:?}"),
    };
    sink.send(text(&HostToRelay::Fetched {
        req,
        status: 200,
        headers: vec![("Content-Type".into(), "video/mp4".into())],
    }))
    .await
    .unwrap();
    // The client reads nothing: once the socket's buffers fill, chunks back up at the
    // relay, and it asks the host to pause.
    let piece = vec![7u8; leaf_protocol::relay::CHUNK_BYTES];
    let mut sent = 0;
    let paused = loop {
        assert!(sent < 200, "no pause after {sent} chunks");
        sink.send(chunk(req, &piece)).await.unwrap();
        sent += 1;
        tokio::time::sleep(Duration::from_millis(5)).await;
        match from_relay.try_recv() {
            Ok(RelayToHost::Ping) | Err(_) => continue,
            Ok(m) => break m,
        }
    };
    assert_eq!(paused, RelayToHost::Pause { req });
    assert!(sent >= 24, "paused after only {sent} chunks");
    // The client reads: the relay drains and lets the host go on.
    let reader = tokio::spawn(async move {
        let mut buf = vec![0u8; 1 << 16];
        let mut total = 0usize;
        loop {
            match client.read(&mut buf).await {
                Ok(0) | Err(_) => break total,
                Ok(n) => total += n,
            }
        }
    });
    assert_eq!(
        next_from(&mut from_relay).await,
        RelayToHost::Resume { req }
    );
    sink.send(chunk(req, b"")).await.unwrap();
    let total = tokio::time::timeout(WAIT, reader).await.unwrap().unwrap();
    assert!(total >= sent * piece.len(), "read {total} of {sent} chunks");
    r.stop().await;
}

#[tokio::test]
async fn a_host_silent_mid_body_ends_the_fetch() {
    let r = start_with(RelayOptions {
        fetch_idle_timeout: Duration::from_millis(200),
        ..options()
    })
    .await;
    let (mut host, shared) = host_share(r.port).await;
    let id = id_of(&shared);
    let mut client = tokio::net::TcpStream::connect(("127.0.0.1", r.port))
        .await
        .unwrap();
    client
        .write_all(
            format!(
                "GET /s/{id}/raw/clip.mp4 HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
                r.port
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let req = fetch_req(&mut host).await;
    host.send(text(&HostToRelay::Fetched {
        req,
        status: 200,
        headers: vec![("Content-Type".into(), "video/mp4".into())],
    }))
    .await
    .unwrap();
    host.send(chunk(req, b"012")).await.unwrap();
    assert_eq!(next_host(&mut host).await, RelayToHost::Cancel { req });
    // The client's response is cut short: no chunked terminator.
    let mut buf = Vec::new();
    tokio::time::timeout(WAIT, client.read_to_end(&mut buf))
        .await
        .unwrap()
        .unwrap();
    assert!(
        !buf.ends_with(b"0\r\n\r\n"),
        "the body must not look complete"
    );
    r.stop().await;
}
