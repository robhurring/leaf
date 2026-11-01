// Serve mode end to end: HTTP routes, the embedded UI, and the WebSocket over the Engine.
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use leaf_app_test_support::*;
use leaf_protocol::{ClientMessage, ServerMessage};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[path = "support.rs"]
mod leaf_app_test_support;

async fn get(port: u16, path: &str, host: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    s.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes(),
    )
    .await
    .unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).await.unwrap();
    let split = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(buf.len());
    let head = String::from_utf8_lossy(&buf[..split]).into_owned();
    let body = buf.get(split + 4..).map(|b| b.to_vec()).unwrap_or_default();
    let mut lines = head.lines();
    let status: u16 = lines
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers = lines
        .filter_map(|l| l.split_once(": "))
        .map(|(k, v)| (k.to_ascii_lowercase(), v.to_string()))
        .collect();
    (status, headers, body)
}
fn header<'a>(h: &'a [(String, String)], name: &str) -> Option<&'a str> {
    h.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
}

#[tokio::test]
async fn http_routes_embedded_ui_and_raw_confinement() {
    let t = start_test_server().await;
    let (status, _, body) = get(t.port, "/healthz", "127.0.0.1").await;
    assert_eq!((status, body.as_slice()), (200, b"ok".as_slice()));

    let (status, h, body) = get(t.port, "/raw/README.md", "localhost").await;
    assert_eq!(status, 200);
    assert!(
        header(&h, "content-type")
            .unwrap()
            .starts_with("text/markdown")
    );
    assert_eq!(header(&h, "x-content-type-options"), Some("nosniff"));
    assert_eq!(body, b"# hello\n");

    let (status, h, _) = get(t.port, "/raw/logo.svg", "127.0.0.1").await;
    assert_eq!(status, 200);
    assert_eq!(header(&h, "content-security-policy"), Some("sandbox"));
    assert_eq!(header(&h, "content-type"), Some("image/svg+xml"));

    let (status, h, body) = get(t.port, "/raw/pic.png", "127.0.0.1").await;
    assert_eq!(status, 200);
    assert_eq!(header(&h, "content-type"), Some("image/png"));
    assert_eq!(body, [0x89, 0x50, 0x4e, 0x47]);

    let (status, _, _) = get(t.port, "/raw/../etc/passwd", "127.0.0.1").await;
    assert!(status == 403 || status == 404, "{status}");
    let (status, _, _) = get(t.port, "/raw/nope.md", "127.0.0.1").await;
    assert_eq!(status, 404);
    let (status, _, _) = get(t.port, "/raw/node_modules/x.js", "127.0.0.1").await;
    assert_eq!(status, 404);

    let (status, h, body) = get(t.port, "/", "127.0.0.1").await;
    assert_eq!(status, 200);
    assert!(header(&h, "content-type").unwrap().starts_with("text/html"));
    assert!(String::from_utf8_lossy(&body).contains("id=\"root\""));
    let (status, _, body) = get(t.port, "/docs/guide.md", "127.0.0.1").await;
    assert_eq!(status, 200);
    assert!(
        String::from_utf8_lossy(&body).contains("id=\"root\""),
        "spa fallback"
    );

    let (status, _, _) = get(t.port, "/healthz", "evil.test").await;
    assert_eq!(status, 403, "foreign Host is refused");
    t.stop().await;
}

async fn ws_connect(
    port: u16,
    origin: Option<&str>,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    String,
> {
    let mut req = format!("ws://127.0.0.1:{port}/ws")
        .into_client_request()
        .unwrap();
    if let Some(o) = origin {
        req.headers_mut().insert("Origin", o.parse().unwrap());
    }
    match tokio_tungstenite::connect_async(req).await {
        Ok((ws, _)) => Ok(ws),
        Err(e) => Err(e.to_string()),
    }
}

async fn next_msg(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<ServerMessage> {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), ws.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => return serde_json::from_str(&t).ok(),
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => return None,
            Ok(Some(Ok(_))) => continue,
            _ => return None,
        }
    }
}

#[tokio::test]
async fn websocket_round_trip_and_live_change() {
    let t = start_test_server().await;
    let mut ws = ws_connect(t.port, Some(&format!("http://localhost:{}", t.port)))
        .await
        .expect("loopback origin accepted");
    let send = |m: ClientMessage| Message::Text(serde_json::to_string(&m).unwrap().into());
    ws.send(send(ClientMessage::Hello {
        protocol: 1,
        name: None,
        id: Some("h".into()),
    }))
    .await
    .unwrap();
    assert!(
        matches!(next_msg(&mut ws).await, Some(ServerMessage::Welcome { in_reply_to: Some(id), .. }) if id == "h")
    );
    ws.send(send(ClientMessage::List {
        path: None,
        id: Some("l".into()),
    }))
    .await
    .unwrap();
    assert!(matches!(
        next_msg(&mut ws).await,
        Some(ServerMessage::Tree { .. })
    ));
    ws.send(send(ClientMessage::Subscribe {
        path: "README.md".into(),
        id: None,
    }))
    .await
    .unwrap();
    ws.send(send(ClientMessage::Read {
        path: "README.md".into(),
        id: Some("r".into()),
    }))
    .await
    .unwrap();
    assert!(
        matches!(next_msg(&mut ws).await, Some(ServerMessage::File { content: Some(c), .. }) if c == "# hello\n")
    );
    std::fs::write(t.root.join("README.md"), "# hello again\n").unwrap();
    assert!(
        matches!(next_msg(&mut ws).await, Some(ServerMessage::Changed { path, .. }) if path == "README.md"),
        "a save shows up as changed"
    );
    t.stop().await;
}

#[tokio::test]
async fn a_message_before_hello_is_refused_and_the_socket_closed() {
    let t = start_test_server().await;
    let mut ws = ws_connect(t.port, None).await.unwrap();
    ws.send(Message::Text(
        r#"{"type":"read","path":"README.md","id":"r"}"#.into(),
    ))
    .await
    .unwrap();
    assert!(
        matches!(next_msg(&mut ws).await, Some(ServerMessage::Error { in_reply_to: Some(id), .. }) if id == "r")
    );
    assert!(
        next_msg(&mut ws).await.is_none(),
        "closed after the refusal"
    );
    t.stop().await;
}

#[tokio::test]
async fn foreign_origin_is_refused() {
    let t = start_test_server().await;
    assert!(ws_connect(t.port, Some("http://evil.test")).await.is_err());
    let mut ok = ws_connect(t.port, Some(&format!("http://127.0.0.1:{}", t.port)))
        .await
        .unwrap();
    ok.close(None).await.ok();
    t.stop().await;
}

#[tokio::test]
async fn bad_json_gets_an_error_and_unknown_types_are_ignored() {
    let t = start_test_server().await;
    let mut ws = ws_connect(t.port, None).await.unwrap();
    ws.send(Message::Text(r#"{"type":"hello","protocol":1}"#.into()))
        .await
        .unwrap();
    assert!(matches!(
        next_msg(&mut ws).await,
        Some(ServerMessage::Welcome { .. })
    ));
    ws.send(Message::Text("not json".into())).await.unwrap();
    assert!(matches!(
        next_msg(&mut ws).await,
        Some(ServerMessage::Error { .. })
    ));
    ws.send(Message::Text(r#"{"type":"dance"}"#.into()))
        .await
        .unwrap();
    ws.send(Message::Text(r#"{"type":"list","id":"after"}"#.into()))
        .await
        .unwrap();
    assert!(
        matches!(next_msg(&mut ws).await, Some(ServerMessage::Tree { in_reply_to: Some(id), .. }) if id == "after"),
        "unknown type ignored, next reply arrives"
    );
    t.stop().await;
}

#[tokio::test]
async fn raw_serves_exact_bytes_and_large_files() {
    let t = start_test_server().await;
    // Latin-1 text: the bytes on disk, not a lossy UTF-8 re-encoding.
    std::fs::write(t.root.join("latin.txt"), [b'c', b'a', b'f', 0xe9, b'\n']).unwrap();
    let (status, _, body) = get(t.port, "/raw/latin.txt", "127.0.0.1").await;
    assert_eq!((status, body), (200, vec![b'c', b'a', b'f', 0xe9, b'\n']));
    // Above the inline cap: streamed whole.
    let big: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(t.root.join("big.bin"), &big).unwrap();
    let (status, h, body) = get(t.port, "/raw/big.bin", "127.0.0.1").await;
    assert_eq!(status, 200);
    assert_eq!(header(&h, "content-length"), Some("3000000"));
    assert!(body == big, "streamed bytes match");
    t.stop().await;
}
