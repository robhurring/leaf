//! One Engine session per WebSocket: frames in, replies and pushes out.
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use leaf_protocol::{ErrorCode, ParseError, ServerMessage, parse_client};

use crate::http::origin_allowed;
use crate::serve::AppState;

pub async fn upgrade(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    if !origin_allowed(origin, &state.allowed_hosts) {
        tracing::warn!(origin = ?origin, "websocket rejected: foreign origin");
        return (StatusCode::FORBIDDEN, "forbidden origin").into_response();
    }
    ws.on_upgrade(move |socket| session(socket, state))
}

fn id_of(raw: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()?
        .get("id")?
        .as_str()
        .map(str::to_string)
}

async fn send(socket: &mut WebSocket, msg: &ServerMessage) -> bool {
    let text = serde_json::to_string(msg).unwrap_or_default();
    socket.send(Message::Text(text.into())).await.is_ok()
}

async fn session(mut socket: WebSocket, state: AppState) {
    let engine = state.engine.clone();
    let me = engine.connect();
    state.clients_changed(1);
    let mut pushes = engine.pushes();
    let mut shutdown = state.shutdown.clone();
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            push = pushes.recv() => {
                match push {
                    Ok((who, msg)) if who == me => {
                        if !send(&mut socket, &msg).await { break; }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(client = me.0, dropped = n, "client fell behind; pushes dropped");
                    }
                    Err(_) => break,
                }
            }
            frame = socket.recv() => {
                let Some(Ok(frame)) = frame else { break };
                let raw = match frame {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                match parse_client(&raw) {
                    Ok(msg) => {
                        for reply in engine.handle(me, msg).await {
                            if !send(&mut socket, &reply).await { break; }
                        }
                        if engine.is_closed(me) {
                            let _ = socket.send(Message::Close(None)).await;
                            break;
                        }
                    }
                    Err(ParseError::UnknownType(t)) => {
                        tracing::warn!(client = me.0, r#type = %t, "unknown message type ignored");
                    }
                    Err(e) => {
                        tracing::warn!(client = me.0, error = %e, "invalid message");
                        let msg = ServerMessage::error(ErrorCode::BadRequest, e.to_string(), None).in_reply_to(id_of(&raw).as_deref());
                        if !send(&mut socket, &msg).await { break; }
                    }
                }
            }
        }
    }
    engine.disconnect(me);
    state.clients_changed(-1);
}
