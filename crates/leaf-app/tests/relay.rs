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

async fn start_relay() -> RelayStarted {
    relay::start(RelayOptions {
        host: "127.0.0.1".into(),
        port: 0,
        public_url: Some(PUBLIC.into()),
        secret: SECRET.to_vec(),
        grace: Duration::from_millis(500),
    })
    .await
    .expect("relay starts")
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
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    s.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
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
    assert_eq!(http_get(r.port, &format!("/s/{id}/raw/a.png")).await.0, 501);
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
