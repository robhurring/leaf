//! `leaf relay start`: the sharing relay. It joins one host WebSocket (a leaf app sharing a
//! tab) to many viewer WebSockets (browsers at `/s/<id>`), forwarding leaf messages inside
//! the host-link envelope. It never reads them, except to patch each viewer's `welcome`.
//! Memory only: a restart ends every share, and hosts come back with their keys.

pub mod hostkey;
pub mod limits;
pub mod share;
pub mod words;

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use leaf_protocol::relay::{HostToRelay, RELAY_PROTOCOL, RelayToHost};
use leaf_protocol::{ErrorCode, PROTOCOL_VERSION, ServerMessage};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::Instant;

use share::Relay;

/// The relay pings the host this often, and viewers' sockets likewise.
pub const PING_EVERY: Duration = Duration::from_secs(25);
/// A host that hasn't answered a ping within this long is treated as dropped.
pub const PONG_WITHIN: Duration = Duration::from_secs(10);
pub const DEFAULT_GRACE: Duration = Duration::from_secs(60);
/// A socket that sends nothing this long after connecting is closed.
pub const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(10);
/// The largest message (and frame) a viewer may send.
pub const MAX_VIEWER_FRAME: usize = 1024 * 1024;
/// The largest message (and frame) a host may send: room for a file at leaf's default
/// 2 MiB inline limit, base64'd, inside its envelope.
pub const MAX_HOST_FRAME: usize = 4 * 1024 * 1024;
/// How long a raw fetch waits for the host's `fetched` before answering 504.
pub const FETCH_HEAD_TIMEOUT: Duration = Duration::from_secs(15);
/// How long a raw body may wait for the host's next frame before it ends with an error.
pub const FETCH_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// The host's reply headers a raw response carries; any others are dropped. The relay
/// sets `X-Content-Type-Options` and `Content-Security-Policy` itself: these bytes are
/// served on the relay's origin, which also runs the viewer page.
const PASSED_HEADERS: [header::HeaderName; 5] = [
    header::CONTENT_TYPE,
    header::CONTENT_RANGE,
    header::CONTENT_LENGTH,
    header::ACCEPT_RANGES,
    header::CACHE_CONTROL,
];

pub struct RelayOptions {
    pub host: String,
    pub port: u16,
    /// Where viewers reach the relay (`https://<app>.herokuapp.com`); else `http://<host>:<port>`.
    pub public_url: Option<String>,
    pub secret: Vec<u8>,
    pub grace: Duration,
    /// Trust `X-Forwarded-For` (its last hop) for the client address: only behind a proxy
    /// that appends it, as Heroku's router does.
    pub trust_proxy: bool,
    pub max_viewers: usize,
    pub first_frame_timeout: Duration,
    /// A raw body the host sends nothing for in this long ends with an error.
    pub fetch_idle_timeout: Duration,
}

impl RelayOptions {
    /// The defaults for everything but where to listen and the secret.
    pub fn new(host: String, port: u16, secret: Vec<u8>) -> RelayOptions {
        RelayOptions {
            host,
            port,
            public_url: None,
            secret,
            grace: DEFAULT_GRACE,
            trust_proxy: false,
            max_viewers: share::MAX_VIEWERS,
            first_frame_timeout: FIRST_FRAME_TIMEOUT,
            fetch_idle_timeout: FETCH_IDLE_TIMEOUT,
        }
    }
}

pub struct RelayStarted {
    pub url: String,
    pub port: u16,
    relay: Arc<Relay>,
    shutdown: watch::Sender<bool>,
    server: JoinHandle<()>,
}

impl RelayStarted {
    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        self.relay.shutdown();
        self.server.abort();
        let _ = self.server.await;
        tracing::info!("stopped");
    }
}

/// A share's links: the web page, and the `leaf://` link the app opens.
pub fn urls(public_url: &str, id: &str) -> (String, String) {
    let bare = public_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(public_url);
    (
        format!("{public_url}/s/{id}"),
        format!("leaf://relay/{bare}/s/{id}"),
    )
}

#[derive(Clone)]
struct RelayState {
    relay: Arc<Relay>,
    shutdown: watch::Receiver<bool>,
    trust_proxy: bool,
    first_frame_timeout: Duration,
    fetch_idle_timeout: Duration,
}

pub async fn start(opts: RelayOptions) -> Result<RelayStarted, String> {
    let listener = tokio::net::TcpListener::bind((opts.host.as_str(), opts.port))
        .await
        .map_err(|e| format!("listen {}:{}: {e}", opts.host, opts.port))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let public_url = opts
        .public_url
        .unwrap_or_else(|| format!("http://{}:{port}", opts.host))
        .trim_end_matches('/')
        .to_string();
    let relay = Arc::new(Relay::new(
        opts.secret,
        opts.grace,
        public_url.clone(),
        opts.max_viewers,
    ));
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let state = RelayState {
        relay: relay.clone(),
        shutdown: shutdown_rx,
        trust_proxy: opts.trust_proxy,
        first_frame_timeout: opts.first_frame_timeout,
        fetch_idle_timeout: opts.fetch_idle_timeout,
    };
    let app = Router::new()
        .route("/healthz", get(crate::http::healthz))
        .route("/host", get(host_upgrade))
        .route("/s/{id}", get(share_page))
        .route("/s/{id}/ws", get(viewer_upgrade))
        .route("/s/{id}/healthz", get(share_health))
        .route("/s/{id}/raw/{*path}", get(share_raw))
        .route("/s/{id}/{*rest}", get(share_page))
        .fallback(crate::http::static_file)
        .with_state(state);
    let server = tokio::spawn(async move {
        let service = app.into_make_service_with_connect_info::<SocketAddr>();
        if let Err(e) = axum::serve(listener, service).await {
            tracing::error!(error = %e, "relay failed");
        }
    });
    tracing::info!(host = %opts.host, port, url = %public_url, "relay listening");
    Ok(RelayStarted {
        url: public_url,
        port,
        relay,
        shutdown: shutdown_tx,
        server,
    })
}

/// `leaf relay start`: runs until ctrl-c or SIGTERM.
pub async fn run(config: leaf_core::config::Config) -> i32 {
    crate::log::init(config.log_level, config.log_format);
    let grace = match std::env::var("LEAF_RELAY_GRACE") {
        Ok(s) => match s.trim().parse::<u64>() {
            Ok(secs) => Duration::from_secs(secs),
            Err(_) => {
                eprintln!("leaf: LEAF_RELAY_GRACE must be a number of seconds, not {s:?}");
                return 2;
            }
        },
        Err(_) => DEFAULT_GRACE,
    };
    let secret = match std::env::var("LEAF_RELAY_SECRET") {
        Ok(s) if !s.is_empty() => s.into_bytes(),
        _ => {
            tracing::warn!("set LEAF_RELAY_SECRET so hosts keep their links across restarts");
            let mut bytes = vec![0u8; 32];
            rand::Rng::fill(&mut rand::rng(), bytes.as_mut_slice());
            bytes
        }
    };
    let public_url = std::env::var("LEAF_RELAY_PUBLIC_URL")
        .ok()
        .filter(|s| !s.is_empty());
    // As leaf's config reads booleans: anything but false/0/no/off/empty is on.
    let trust_proxy = std::env::var("LEAF_RELAY_TRUST_PROXY").is_ok_and(|v| {
        !matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "false" | "0" | "no" | "off" | ""
        )
    });
    let started = match start(RelayOptions {
        public_url,
        grace,
        trust_proxy,
        ..RelayOptions::new(config.host.clone(), config.port, secret)
    })
    .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "cannot start");
            eprintln!("leaf: cannot start the relay: {e}");
            return 1;
        }
    };
    // As in serve mode, the URL is the command's output and shows at every log level.
    println!("{}", started.url);
    let reason = tokio::select! {
        _ = tokio::signal::ctrl_c() => "SIGINT",
        _ = async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal");
            term.recv().await
        } => "SIGTERM",
    };
    tracing::info!(reason, "shutting down");
    started.stop().await;
    0
}

async fn share_page(Path(params): Path<Vec<(String, String)>>, uri: Uri) -> Response {
    let id = params
        .iter()
        .find(|(k, _)| k == "id")
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    crate::http::static_file_at(uri, &format!("/s/{id}")).await
}

/// Live or in grace: 200. Unknown ids count against the asker, as viewer joins do.
async fn share_health(
    Path(id): Path<String>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(s): State<RelayState>,
) -> Response {
    let ip = client_ip(&headers, peer, s.trust_proxy);
    if !s.relay.limits.allow(ip) {
        tracing::warn!(%ip, "share health refused: too many unknown shares");
        return (StatusCode::TOO_MANY_REQUESTS, "too many tries").into_response();
    }
    if s.relay.exists(&id) {
        (StatusCode::OK, "ok").into_response()
    } else {
        s.relay.limits.failed(ip, &id);
        (StatusCode::NOT_FOUND, "not found").into_response()
    }
}

/// A raw fetch's HTTP side. Dropped (the client left, the head never came, or the
/// body is done), it frees the fetch and tells the host if it hadn't finished.
struct FetchGuard {
    relay: Arc<Relay>,
    id: String,
    req: u32,
}

impl Drop for FetchGuard {
    fn drop(&mut self) {
        self.relay.cancel_fetch(&self.id, self.req);
    }
}

/// File bytes through the host: it answers `fetch` with `fetched` and then the body in
/// binary frames, which stream out as they come.
async fn share_raw(
    Path((id, path)): Path<(String, String)>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(s): State<RelayState>,
) -> Response {
    let ip = client_ip(&headers, peer, s.trust_proxy);
    if !s.relay.limits.allow(ip) {
        tracing::warn!(%ip, "raw refused: too many unknown shares");
        return (StatusCode::TOO_MANY_REQUESTS, "too many tries").into_response();
    }
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let path_mime = leaf_core::classify::classify(std::path::Path::new(&path)).mime;
    let started = match s.relay.start_fetch(&id, path, range) {
        Ok(started) => started,
        Err(share::FetchRefused::Gone) => {
            s.relay.limits.failed(ip, &id);
            return (StatusCode::NOT_FOUND, "not found").into_response();
        }
        Err(share::FetchRefused::Away) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                [(header::RETRY_AFTER, "5")],
                "the host is reconnecting",
            )
                .into_response();
        }
        Err(share::FetchRefused::Busy) => {
            return (StatusCode::TOO_MANY_REQUESTS, "too many files at once").into_response();
        }
    };
    let guard = FetchGuard {
        relay: s.relay.clone(),
        id,
        req: started.req,
    };
    let (status, head) = match tokio::time::timeout(FETCH_HEAD_TIMEOUT, started.head).await {
        Ok(Ok(head)) => head,
        Ok(Err(_)) => return (StatusCode::BAD_GATEWAY, "the host went away").into_response(),
        Err(_) => {
            tracing::warn!(share = %guard.id, req = guard.req, "host did not answer a fetch");
            return (StatusCode::GATEWAY_TIMEOUT, "the host did not answer").into_response();
        }
    };
    let (complete, paused, idle) = (started.complete, started.paused, s.fetch_idle_timeout);
    let body = futures_util::stream::unfold(Some((started.body, guard)), move |state| {
        let (complete, paused) = (complete.clone(), paused.clone());
        async move {
            let (mut rx, guard) = state?;
            match tokio::time::timeout(idle, rx.recv()).await {
                Ok(Some(bytes)) => {
                    if paused.load(Ordering::Acquire) && rx.len() <= share::RESUME_AT {
                        guard.relay.fetch_drained(&guard.id, guard.req);
                    }
                    Some((Ok(bytes), Some((rx, guard))))
                }
                Ok(None) if complete.load(Ordering::Acquire) => None,
                Ok(None) => Some((Err(std::io::Error::other("the host stopped sending")), None)),
                Err(_) => {
                    tracing::warn!(share = %guard.id, req = guard.req, "host went quiet mid-body");
                    Some((Err(std::io::Error::other("the host went quiet")), None))
                }
            }
        }
    });
    let mut response = Response::new(Body::from_stream(body));
    *response.status_mut() = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
    for (name, value) in head {
        if let Some(name) = PASSED_HEADERS
            .iter()
            .find(|n| n.as_str().eq_ignore_ascii_case(&name))
            && let Ok(value) = header::HeaderValue::from_str(&value)
        {
            response.headers_mut().insert(name.clone(), value);
        }
    }
    let host_mime = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    if crate::http::scriptable(&host_mime) || crate::http::scriptable(&path_mime) {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            header::HeaderValue::from_static("sandbox"),
        );
    }
    response
}

/// The address limits count against: the peer, or behind a trusted proxy the last
/// `X-Forwarded-For` hop (the one the proxy appended; earlier hops are the client's say-so).
pub fn client_ip(headers: &HeaderMap, peer: SocketAddr, trust_proxy: bool) -> IpAddr {
    if !trust_proxy {
        return peer.ip();
    }
    headers
        .get_all("x-forwarded-for")
        .iter()
        .next_back()
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit(',').next())
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(peer.ip())
}

/// A page's Origin must be this relay (same-origin); clients with no Origin are allowed.
fn same_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
    let origin_host = origin
        .to_str()
        .ok()
        .and_then(|o| o.split_once("://"))
        .map(|(_, rest)| rest.split('/').next().unwrap_or(""));
    matches!((origin_host, host), (Some(o), Some(h)) if o.eq_ignore_ascii_case(h))
}

async fn host_upgrade(ws: WebSocketUpgrade, State(s): State<RelayState>) -> Response {
    ws.max_message_size(MAX_HOST_FRAME)
        .max_frame_size(MAX_HOST_FRAME)
        .on_upgrade(move |socket| host_session(socket, s))
}

async fn viewer_upgrade(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    headers: HeaderMap,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(s): State<RelayState>,
) -> Response {
    if !same_origin(&headers) {
        tracing::warn!(origin = ?headers.get(header::ORIGIN), "viewer rejected: foreign origin");
        return (StatusCode::FORBIDDEN, "forbidden origin").into_response();
    }
    let ip = client_ip(&headers, peer, s.trust_proxy);
    if !s.relay.limits.allow(ip) {
        tracing::warn!(%ip, "viewer refused: too many unknown shares");
        return (StatusCode::TOO_MANY_REQUESTS, "too many tries").into_response();
    }
    if !s.relay.exists(&id) {
        s.relay.limits.failed(ip, &id);
        tracing::info!(%ip, "viewer asked for an unknown share");
        return ws.on_upgrade(|mut socket| async move {
            let _ = socket.send(share::unknown_share_close()).await;
        });
    }
    ws.max_message_size(MAX_VIEWER_FRAME)
        .max_frame_size(MAX_VIEWER_FRAME)
        .on_upgrade(move |socket| viewer_session(socket, id, s))
}

fn json<T: serde::Serialize>(m: &T) -> Message {
    Message::Text(serde_json::to_string(m).unwrap_or_default().into())
}

/// The first text frame, or None when the socket closes, the relay stops, or nothing
/// comes within `wait` (the socket is then closed).
async fn first_text(
    socket: &mut WebSocket,
    shutdown: &mut watch::Receiver<bool>,
    wait: Duration,
) -> Option<String> {
    let deadline = tokio::time::sleep(wait);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = shutdown.changed() => return None,
            _ = &mut deadline => {
                tracing::info!("socket sent nothing; closed");
                let _ = socket.send(Message::Close(None)).await;
                return None;
            }
            frame = socket.recv() => match frame {
                Some(Ok(Message::Text(t))) => return Some(t.to_string()),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return None,
                Some(Ok(_)) => continue,
            }
        }
    }
}

async fn refuse_host(mut socket: WebSocket, code: &str, message: String) {
    tracing::warn!(code, %message, "host refused");
    let _ = socket
        .send(json(&RelayToHost::Error {
            code: code.to_string(),
            message,
        }))
        .await;
    let _ = socket.send(Message::Close(None)).await;
}

async fn host_session(mut socket: WebSocket, s: RelayState) {
    let mut shutdown = s.shutdown.clone();
    let Some(first) = first_text(&mut socket, &mut shutdown, s.first_frame_timeout).await else {
        return;
    };
    let version = format!(
        "this relay runs leaf protocol {PROTOCOL_VERSION}; update leaf (brew upgrade --cask leaf)"
    );
    let Ok(HostToRelay::Share {
        protocol,
        relay_protocol,
        name,
        mode,
        resume,
        ..
    }) = serde_json::from_str::<HostToRelay>(&first)
    else {
        return refuse_host(socket, "version", version).await;
    };
    if protocol != PROTOCOL_VERSION || relay_protocol != RELAY_PROTOCOL {
        return refuse_host(socket, "version", version).await;
    }
    let conn = s.relay.new_conn();
    let (tx, mut rx) = mpsc::channel(share::QUEUE_FRAMES);
    let id = match s.relay.share(conn, tx, &name, mode, resume) {
        Ok(a) => {
            // `shared` and the replay go first; anything queued since comes after.
            let mut ok = socket.send(a.shared).await.is_ok();
            for frame in a.replay {
                ok = ok && socket.send(Message::Text(frame.into())).await.is_ok();
            }
            if !ok {
                s.relay.host_dropped(&a.id, conn);
                return;
            }
            a.id
        }
        Err(r) => return refuse_host(socket, r.code, r.message).await,
    };

    let mut ping = tokio::time::interval_at(Instant::now() + PING_EVERY, PING_EVERY);
    let mut pong_due: Option<Instant> = None;
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            out = rx.recv() => match out {
                Some(Message::Close(f)) => {
                    let _ = socket.send(Message::Close(f)).await;
                    break;
                }
                Some(m) => if socket.send(m).await.is_err() { break },
                None => break,
            },
            _ = ping.tick() => {
                if socket.send(json(&RelayToHost::Ping)).await.is_err() { break }
                pong_due.get_or_insert(Instant::now() + PONG_WITHIN);
            }
            _ = tokio::time::sleep_until(pong_due.unwrap_or_else(Instant::now)), if pong_due.is_some() => {
                tracing::warn!(share = %id, "host missed its pong");
                break;
            }
            frame = socket.recv() => {
                let t = match frame {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Binary(b))) => {
                        if b.len() >= 4 {
                            let req = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
                            s.relay.fetch_bytes(&id, conn, req, b.slice(4..));
                        }
                        continue;
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                match serde_json::from_str::<HostToRelay>(&t) {
                    Ok(HostToRelay::ToViewer { viewer, msg }) => s.relay.to_viewer(&id, conn, &viewer, msg),
                    Ok(HostToRelay::Fetched { req, status, headers }) => s.relay.fetched(&id, conn, req, (status, headers)),
                    Ok(HostToRelay::Path { path }) => s.relay.path(&id, conn, path),
                    Ok(HostToRelay::End) => s.relay.end(&id, conn),
                    Ok(HostToRelay::Pong) => pong_due = None,
                    Ok(other) => tracing::debug!(share = %id, msg = ?other, "host message ignored"),
                    Err(e) => tracing::warn!(share = %id, error = %e, "invalid host message"),
                }
            }
        }
    }
    // After `end` the share is gone and this does nothing; when the relay stops there's no grace.
    if !*shutdown.borrow() {
        s.relay.host_dropped(&id, conn);
    }
}

async fn viewer_session(mut socket: WebSocket, id: String, s: RelayState) {
    let mut shutdown = s.shutdown.clone();
    let Some(first) = first_text(&mut socket, &mut shutdown, s.first_frame_timeout).await else {
        return;
    };
    let hello = serde_json::from_str::<Value>(&first)
        .ok()
        .filter(|v| v.get("type").and_then(Value::as_str) == Some("hello"));
    let reply_to = hello
        .as_ref()
        .and_then(|v| v.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let refusal = match &hello {
        None => Some("the first message must be hello".to_string()),
        Some(h) if h.get("protocol").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) => {
            Some(format!(
                "this share runs leaf protocol {PROTOCOL_VERSION}; reload"
            ))
        }
        Some(_) => None,
    };
    let (Some(hello), None) = (hello, refusal.clone()) else {
        let message = refusal.unwrap_or_default();
        tracing::info!(share = %id, %message, "viewer refused");
        let msg = ServerMessage::error(ErrorCode::BadRequest, message, None)
            .in_reply_to(reply_to.as_deref());
        let _ = socket.send(json(&msg)).await;
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let name = hello
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string);
    let (tx, mut rx) = mpsc::channel(share::QUEUE_FRAMES);
    let vid = match s.relay.join(&id, name, hello, tx) {
        Ok(vid) => vid,
        Err(share::JoinRefused::Gone) => {
            let _ = socket.send(share::unknown_share_close()).await;
            return;
        }
        Err(share::JoinRefused::Full) => {
            let msg = ServerMessage::error(ErrorCode::BadRequest, "this share is full", None)
                .in_reply_to(reply_to.as_deref());
            let _ = socket.send(json(&msg)).await;
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };

    let mut ping = tokio::time::interval_at(Instant::now() + PING_EVERY, PING_EVERY);
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            out = rx.recv() => match out {
                Some(Message::Close(f)) => {
                    let _ = socket.send(Message::Close(f)).await;
                    break;
                }
                Some(m) => if socket.send(m).await.is_err() { break },
                None => break,
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Default::default())).await.is_err() { break }
            }
            frame = socket.recv() => {
                let t = match frame {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => continue,
                };
                match serde_json::from_str::<Value>(&t) {
                    Ok(msg) => s.relay.from_viewer(&id, &vid, msg),
                    Err(e) => tracing::warn!(share = %id, viewer = %vid, error = %e, "invalid viewer message"),
                }
            }
        }
    }
    s.relay.viewer_left(&id, &vid);
}
