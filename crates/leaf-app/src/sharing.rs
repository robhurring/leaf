//! The host side of sharing: one outbound WebSocket to the relay (the "host link") that
//! feeds each viewer's messages into a tab's engine as a session of its own and sends the
//! replies, pushes and raw file bytes back. The host is the authority on what a viewer
//! may do: read-only messages only, nothing outside the root or ignored, no preferences.
//! No Tauri in here; the app holds the `ShareHandle`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use leaf_core::engine::{Engine, SessionId};
use leaf_protocol::relay::{
    CHUNK_BYTES, HostToRelay, Peer, RELAY_PROTOCOL, RelayToHost, ShareMode,
};
use leaf_protocol::{
    ClientMessage, ErrorCode, PROTOCOL_VERSION, PointerAt, RootInfo, ServerMessage, Slide,
    StageRef, Stroke,
};
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;

use crate::relay::share::{HOST_ID, color_for};

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// How long to wait for the relay's `shared` after connecting.
const SHARED_WITHIN: Duration = Duration::from_secs(10);
/// The relay pings every 25 s; this long without hearing anything, the link is dead.
const SILENT_FOR: Duration = Duration::from_secs(60);
/// Reconnect delays: 1, 2, 4, 8, 8, … seconds.
const BACKOFF: [u64; 4] = [1, 2, 4, 8];
/// Frames and messages waiting for the socket; raw fetches wait when it's full.
const OUT_QUEUE: usize = 32;

/// The message types a share mode lets a viewer send.
const READ_ONLY: [&str; 8] = [
    "hello",
    "list",
    "read",
    "subscribe",
    "unsubscribe",
    "search",
    "searchText",
    "blame",
];

pub struct HostOptions {
    /// The relay's base URL (`https://…` or `http://…`).
    pub relay_url: String,
    pub name: String,
    pub root: RootInfo,
    pub mode: ShareMode,
    pub engine: Arc<Engine>,
    /// Take back an earlier share's id (after the app restarts, say).
    pub resume: Option<leaf_protocol::relay::Resume>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkStatus {
    Connected,
    Reconnecting,
    Ended,
}

enum Cmd {
    Path(Option<String>),
    Slide(Option<Slide>),
    Stage(Option<StageRef>),
    Ink(Stroke),
    Inking(Stroke),
    InkUndo {
        doc_path: String,
        block_hash: String,
    },
    InkClear {
        doc_path: String,
        block_hash: String,
    },
    End,
}

/// A live share. Dropping it without `end()` only closes the link: the relay keeps the
/// share for its grace period, so the same id can be resumed with `host_key`.
pub struct ShareHandle {
    pub id: String,
    pub host_key: String,
    pub web_url: String,
    pub app_url: String,
    pub viewers: watch::Receiver<Vec<Peer>>,
    pub status: watch::Receiver<LinkStatus>,
    cmds: mpsc::UnboundedSender<Cmd>,
    /// The latest pointer not yet sent (outer `None`: nothing pending); a newer one
    /// replaces it, so a busy socket never queues pointers.
    pointer: watch::Sender<Option<Option<PointerAt>>>,
    /// Viewers see git history (each file's last commit, blame). Off unless the host asks.
    git: Arc<AtomicBool>,
    /// The relay announced the `presence` capability: slide and stage may be sent.
    presence: Arc<AtomicBool>,
    /// What the host's own tab should see (presence), taken once.
    inbox: Mutex<Option<mpsc::UnboundedReceiver<ServerMessage>>>,
}

impl ShareHandle {
    /// What the host is reading now, for viewers' presence.
    pub fn set_path(&self, path: Option<String>) {
        let _ = self.cmds.send(Cmd::Path(path));
    }

    /// The slide the host is on, for viewers; silent when the relay can't take it.
    pub fn set_slide(&self, slide: Option<Slide>) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::Slide(slide));
        }
    }

    /// The canvas the host has open, for viewers; silent when the relay can't take it.
    pub fn set_stage(&self, stage: Option<StageRef>) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::Stage(stage));
        }
    }

    /// Where the host's pointer is on the open block (`None`: it left). Only the latest
    /// is sent when the socket is free; silent when the relay can't take it.
    pub fn pointer(&self, pointer: Option<PointerAt>) {
        if self.presence_capable() {
            self.pointer.send_replace(Some(pointer));
        }
    }

    /// A stroke the host drew, for viewers; silent when the relay can't take it.
    pub fn ink(&self, stroke: Stroke) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::Ink(stroke));
        }
    }

    /// A stroke the host is drawing (the points since the last frame), for viewers; silent
    /// when the relay can't take it.
    pub fn inking(&self, stroke: Stroke) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::Inking(stroke));
        }
    }

    /// Takes back the host's last stroke on a block; silent when the relay can't take it.
    pub fn ink_undo(&self, doc_path: String, block_hash: String) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::InkUndo {
                doc_path,
                block_hash,
            });
        }
    }

    /// Wipes the host's strokes on a block; silent when the relay can't take it.
    pub fn ink_clear(&self, doc_path: String, block_hash: String) {
        if self.presence_capable() {
            let _ = self.cmds.send(Cmd::InkClear {
                doc_path,
                block_hash,
            });
        }
    }

    /// Whether the relay speaks presence (checked at start and after each resume).
    pub fn presence_capable(&self) -> bool {
        self.presence.load(Ordering::Relaxed)
    }

    /// The messages the host's own tab should see; there is one receiver, so only the
    /// first call gets it.
    pub fn take_inbox(&self) -> Option<mpsc::UnboundedReceiver<ServerMessage>> {
        self.inbox.lock().ok()?.take()
    }

    /// Whether viewers see git history; applies to their next request.
    pub fn set_git(&self, on: bool) {
        self.git.store(on, Ordering::Relaxed);
    }
    pub fn git(&self) -> bool {
        self.git.load(Ordering::Relaxed)
    }

    /// Ends the share: the relay tells viewers and frees the id.
    pub fn end(&self) {
        let _ = self.cmds.send(Cmd::End);
    }
}

/// True when `mode` lets a viewer send `msg`.
pub fn allowed(msg: &Value, mode: ShareMode) -> bool {
    let ty = msg.get("type").and_then(Value::as_str).unwrap_or("");
    match mode {
        ShareMode::ReadOnly => READ_ONLY.contains(&ty),
    }
}

/// The name viewers see for the host.
pub fn host_name(env: &HashMap<String, String>) -> String {
    ["LEAF_NAME", "USER", "LOGNAME"]
        .iter()
        .filter_map(|k| env.get(*k))
        .map(|v| v.trim())
        .find(|v| !v.is_empty())
        .unwrap_or("Host")
        .to_string()
}

/// `https://r.example/` → `wss://r.example/host`.
fn host_url(relay_url: &str) -> String {
    let base = relay_url.trim().trim_end_matches('/');
    let base = if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base.to_string()
    };
    format!("{base}/host")
}

fn text<T: serde::Serialize>(m: &T) -> Message {
    Message::Text(serde_json::to_string(m).unwrap_or_default().into())
}

struct Shared {
    id: String,
    host_key: String,
    web_url: String,
    app_url: String,
    viewers: Vec<Peer>,
    capabilities: Vec<String>,
}

enum Refused {
    /// The relay said no for good: version, bad key, unknown share.
    Final(String),
    /// Unreachable or dropped: worth another try.
    Retry(String),
}

/// Connects, sends `share`, and waits for `shared`.
async fn open_link(
    opts: &HostOptions,
    resume: Option<leaf_protocol::relay::Resume>,
) -> Result<(Ws, Shared), Refused> {
    let url = host_url(&opts.relay_url);
    let (mut ws, _) = tokio::time::timeout(SHARED_WITHIN, tokio_tungstenite::connect_async(&url))
        .await
        .map_err(|_| Refused::Retry(format!("cannot reach the relay at {url}: timed out")))?
        .map_err(|e| Refused::Retry(format!("cannot reach the relay at {url}: {e}")))?;
    let share = HostToRelay::Share {
        protocol: PROTOCOL_VERSION,
        relay_protocol: RELAY_PROTOCOL,
        name: opts.name.clone(),
        root: opts.root.clone(),
        mode: opts.mode,
        resume,
    };
    ws.send(text(&share))
        .await
        .map_err(|e| Refused::Retry(format!("the relay dropped the link: {e}")))?;
    let answer = tokio::time::timeout(SHARED_WITHIN, async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => return Some(t.to_string()),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return None,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await
    .map_err(|_| Refused::Retry("the relay did not answer".into()))?
    .ok_or_else(|| Refused::Retry("the relay closed the link".into()))?;
    match serde_json::from_str::<RelayToHost>(&answer) {
        Ok(RelayToHost::Shared {
            id,
            host_key,
            web_url,
            app_url,
            viewers,
            capabilities,
        }) => Ok((
            ws,
            Shared {
                id,
                host_key,
                web_url,
                app_url,
                viewers,
                capabilities,
            },
        )),
        Ok(RelayToHost::Error { code, message }) => {
            tracing::warn!(%code, %message, "relay refused the share");
            Err(Refused::Final(message))
        }
        _ => Err(Refused::Retry(format!(
            "unexpected answer from the relay: {answer}"
        ))),
    }
}

/// Shares `opts.engine` through the relay; resolves once the relay has given it an id.
pub async fn start(opts: HostOptions) -> Result<ShareHandle, String> {
    start_checked(opts).await.map_err(|e| e.message)
}

/// Why a share did not start: `permanent` when the relay refused it for good (a share it
/// doesn't know, a wrong key, a version it can't speak), so trying again cannot help.
#[derive(Debug)]
pub struct StartError {
    pub message: String,
    pub permanent: bool,
}

/// `start`, saying whether a failure is worth retrying.
pub async fn start_checked(opts: HostOptions) -> Result<ShareHandle, StartError> {
    let (ws, shared) = match open_link(&opts, opts.resume.clone()).await {
        Ok(ok) => ok,
        Err(Refused::Final(message)) => {
            return Err(StartError {
                message,
                permanent: true,
            });
        }
        Err(Refused::Retry(message)) => {
            return Err(StartError {
                message,
                permanent: false,
            });
        }
    };
    tracing::info!(share = %shared.id, url = %shared.web_url, "sharing");
    let (viewers_tx, viewers) = watch::channel(Vec::new());
    let (status_tx, status) = watch::channel(LinkStatus::Connected);
    let (cmds, cmd_rx) = mpsc::unbounded_channel();
    let (out_tx, out_rx) = mpsc::channel(OUT_QUEUE);
    let git = Arc::new(AtomicBool::new(false));
    let presence = Arc::new(AtomicBool::new(has_presence(&shared.capabilities)));
    let (inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    let (pointer, pointer_rx) = watch::channel(None);
    let handle = ShareHandle {
        id: shared.id.clone(),
        host_key: shared.host_key.clone(),
        web_url: shared.web_url,
        app_url: shared.app_url,
        viewers,
        status,
        cmds,
        pointer,
        git: git.clone(),
        presence: presence.clone(),
        inbox: Mutex::new(Some(inbox_rx)),
    };
    let link = Link {
        pushes: opts.engine.pushes(),
        opts,
        git,
        presence,
        inbox_tx,
        pointer_rx,
        id: shared.id,
        host_key: shared.host_key,
        path: None,
        slide: None,
        stage: None,
        viewers: HashMap::new(),
        fetches: HashMap::new(),
        viewers_tx,
        status_tx,
        out_tx,
        out_rx,
        pending: Vec::new(),
        cmd_rx,
    };
    tokio::spawn(link.run(ws));
    Ok(handle)
}

fn has_presence(capabilities: &[String]) -> bool {
    capabilities.iter().any(|c| c == "presence")
}

/// What goes out on the socket, queued by viewer and fetch tasks.
enum Out {
    /// A message for a viewer: kept across a reconnect (the relay still has the viewer
    /// while it is in grace).
    Viewer(Message),
    /// A fetch's head or bytes: dropped with the link, as the relay drops its fetches.
    Fetch(Message),
}

struct ViewerLink {
    peer: Peer,
    sid: SessionId,
    inbox: mpsc::UnboundedSender<Value>,
    task: JoinHandle<()>,
}

struct FetchLink {
    paused: watch::Sender<bool>,
    task: JoinHandle<()>,
}

/// How a connected stretch of the link ended.
enum Stop {
    /// `end()`, or the handle was dropped: stop for good.
    Done,
    /// The socket went away: reconnect.
    Lost,
    /// The relay ended the share for good.
    Ended,
}

struct Link {
    opts: HostOptions,
    /// Shared with the handle: whether viewers see git history.
    git: Arc<AtomicBool>,
    /// Shared with the handle: whether the relay takes slide and stage.
    presence: Arc<AtomicBool>,
    /// Presence for the host's own tab.
    inbox_tx: mpsc::UnboundedSender<ServerMessage>,
    /// The handle's pending pointer; only the latest is ever sent.
    pointer_rx: watch::Receiver<Option<Option<PointerAt>>>,
    id: String,
    host_key: String,
    path: Option<String>,
    slide: Option<Slide>,
    stage: Option<StageRef>,
    viewers: HashMap<String, ViewerLink>,
    fetches: HashMap<u32, FetchLink>,
    pushes: broadcast::Receiver<(SessionId, ServerMessage)>,
    viewers_tx: watch::Sender<Vec<Peer>>,
    status_tx: watch::Sender<LinkStatus>,
    out_tx: mpsc::Sender<Out>,
    out_rx: mpsc::Receiver<Out>,
    /// Viewer messages that were queued when the last link went; sent first on the next.
    pending: Vec<Message>,
    cmd_rx: mpsc::UnboundedReceiver<Cmd>,
}

impl Link {
    async fn run(mut self, mut ws: Ws) {
        loop {
            match self.connected(&mut ws).await {
                Stop::Done | Stop::Ended => break,
                Stop::Lost => {}
            }
            self.link_lost();
            match self.reconnect().await {
                Some(next) => ws = next,
                None => break,
            }
        }
        self.finish();
    }

    /// Serves the relay until the socket goes, the share ends, or the handle says stop.
    async fn connected(&mut self, ws: &mut Ws) -> Stop {
        for m in std::mem::take(&mut self.pending) {
            if ws.send(m).await.is_err() {
                return Stop::Lost;
            }
        }
        // A pointer is ephemeral: whatever piled up while the link was away is stale.
        self.pointer_rx.mark_unchanged();
        let silence = tokio::time::sleep(SILENT_FOR);
        tokio::pin!(silence);
        loop {
            tokio::select! {
                cmd = self.cmd_rx.recv() => match cmd {
                    Some(Cmd::Path(path)) => {
                        self.path = path.clone();
                        if ws.send(text(&HostToRelay::Path { path })).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::Slide(slide)) => {
                        self.slide = slide.clone();
                        if ws.send(text(&HostToRelay::Slide { slide })).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::Stage(stage)) => {
                        self.stage = stage.clone();
                        if ws.send(text(&HostToRelay::Stage { stage })).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::Ink(stroke)) => {
                        if ws.send(text(&HostToRelay::Ink { stroke })).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::Inking(stroke)) => {
                        if ws.send(text(&HostToRelay::Inking { stroke })).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::InkUndo { doc_path, block_hash }) => {
                        let m = HostToRelay::InkUndo { doc_path, block_hash };
                        if ws.send(text(&m)).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::InkClear { doc_path, block_hash }) => {
                        let m = HostToRelay::InkClear { doc_path, block_hash };
                        if ws.send(text(&m)).await.is_err() {
                            return Stop::Lost;
                        }
                    }
                    Some(Cmd::End) => {
                        tracing::info!(share = %self.id, "ending the share");
                        let _ = ws.send(text(&HostToRelay::End)).await;
                        let _ = ws.close(None).await;
                        let _ = self.status_tx.send(LinkStatus::Ended);
                        return Stop::Done;
                    }
                    None => {
                        tracing::info!(share = %self.id, "share handle dropped; leaving it to the relay's grace");
                        let _ = ws.close(None).await;
                        return Stop::Done;
                    }
                },
                Ok(()) = self.pointer_rx.changed() => {
                    let latest = self.pointer_rx.borrow_and_update().clone();
                    if let Some(pointer) = latest
                        && ws.send(text(&HostToRelay::Pointer { pointer })).await.is_err()
                    {
                        return Stop::Lost;
                    }
                }
                out = self.out_rx.recv() => {
                    let m = match out {
                        Some(Out::Viewer(m) | Out::Fetch(m)) => m,
                        None => continue,
                    };
                    if ws.send(m).await.is_err() {
                        return Stop::Lost;
                    }
                }
                push = self.pushes.recv() => match push {
                    Ok((sid, msg)) => {
                        if let Some(vid) = self.viewer_of(sid) {
                            let m = to_viewer(&vid, serde_json::to_value(&msg).unwrap_or(Value::Null));
                            if ws.send(m).await.is_err() {
                                return Stop::Lost;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(share = %self.id, missed = n, "viewer pushes fell behind");
                    }
                    Err(broadcast::error::RecvError::Closed) => {}
                },
                _ = &mut silence => {
                    tracing::warn!(share = %self.id, "the relay went quiet");
                    return Stop::Lost;
                }
                frame = ws.next() => {
                    let t = match frame {
                        Some(Ok(Message::Text(t))) => t,
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return Stop::Lost,
                        Some(Ok(_)) => continue,
                    };
                    silence.as_mut().reset(tokio::time::Instant::now() + SILENT_FOR);
                    match serde_json::from_str::<RelayToHost>(&t) {
                        Ok(RelayToHost::Ping) => {
                            if ws.send(text(&HostToRelay::Pong)).await.is_err() {
                                return Stop::Lost;
                            }
                        }
                        Ok(RelayToHost::Error { code, message }) => {
                            tracing::warn!(share = %self.id, %code, %message, "relay error");
                            if matches!(code.as_str(), "bad-key" | "unknown-share" | "version") {
                                let _ = self.status_tx.send(LinkStatus::Ended);
                                return Stop::Ended;
                            }
                        }
                        Ok(msg) => self.on_relay(msg),
                        Err(e) => tracing::warn!(share = %self.id, error = %e, "invalid relay message"),
                    }
                }
            }
        }
    }

    fn viewer_of(&self, sid: SessionId) -> Option<String> {
        self.viewers
            .iter()
            .find(|(_, v)| v.sid == sid)
            .map(|(id, _)| id.clone())
    }

    fn publish_viewers(&self) {
        let mut peers: Vec<Peer> = self.viewers.values().map(|v| v.peer.clone()).collect();
        peers.sort_by(|a, b| a.id.cmp(&b.id));
        let _ = self.viewers_tx.send(peers);
    }

    fn on_relay(&mut self, msg: RelayToHost) {
        match msg {
            RelayToHost::Joined {
                viewer,
                name,
                color,
            } => {
                // A restarted relay counts viewers from scratch: an id we still hold is stale.
                self.drop_viewer(&viewer);
                let sid = self.opts.engine.connect();
                let (inbox, rx) = mpsc::unbounded_channel();
                let task = tokio::spawn(serve_viewer(
                    self.opts.engine.clone(),
                    self.opts.mode,
                    self.git.clone(),
                    sid,
                    viewer.clone(),
                    rx,
                    self.out_tx.clone(),
                ));
                tracing::info!(share = %self.id, %viewer, %name, "viewer joined");
                self.viewers.insert(
                    viewer.clone(),
                    ViewerLink {
                        peer: Peer {
                            id: viewer,
                            name,
                            color,
                            path: None,
                        },
                        sid,
                        inbox,
                        task,
                    },
                );
                self.publish_viewers();
            }
            RelayToHost::Left { viewer } => {
                tracing::info!(share = %self.id, %viewer, "viewer left");
                self.drop_viewer(&viewer);
                self.publish_viewers();
            }
            RelayToHost::FromViewer { viewer, msg } => match self.viewers.get(&viewer) {
                Some(v) => {
                    let _ = v.inbox.send(msg);
                }
                None => {
                    tracing::debug!(share = %self.id, %viewer, "message from an unknown viewer dropped")
                }
            },
            RelayToHost::Fetch { req, path, range } => {
                self.fetches.retain(|_, f| !f.task.is_finished());
                let (paused, paused_rx) = watch::channel(false);
                let task = tokio::spawn(serve_fetch(
                    self.opts.engine.clone(),
                    req,
                    path,
                    range,
                    paused_rx,
                    self.out_tx.clone(),
                ));
                if let Some(old) = self.fetches.insert(req, FetchLink { paused, task }) {
                    old.task.abort();
                }
            }
            RelayToHost::Cancel { req } => {
                if let Some(f) = self.fetches.remove(&req) {
                    f.task.abort();
                }
            }
            RelayToHost::Pause { req } => {
                if let Some(f) = self.fetches.get(&req) {
                    let _ = f.paused.send(true);
                }
            }
            RelayToHost::Resume { req } => {
                if let Some(f) = self.fetches.get(&req) {
                    let _ = f.paused.send(false);
                }
            }
            RelayToHost::Presence { viewers } => {
                let _ = self.inbox_tx.send(ServerMessage::Presence {
                    host: self.host_peer(),
                    host_path: self.path.clone(),
                    viewers,
                    you: HOST_ID.into(),
                    slide: self.slide.clone(),
                    stage: self.stage.clone(),
                    in_reply_to: None,
                });
            }
            RelayToHost::Pointer { viewer, pointer } => {
                let _ = self.inbox_tx.send(ServerMessage::Pointer {
                    peer: viewer,
                    pointer,
                    in_reply_to: None,
                });
            }
            RelayToHost::Ink { viewer, stroke } => {
                let _ = self.inbox_tx.send(ServerMessage::Ink {
                    peer: viewer,
                    stroke,
                    in_reply_to: None,
                });
            }
            RelayToHost::Inking { viewer, stroke } => {
                let _ = self.inbox_tx.send(ServerMessage::Inking {
                    peer: viewer,
                    stroke,
                    in_reply_to: None,
                });
            }
            RelayToHost::InkUndo {
                viewer,
                doc_path,
                block_hash,
            } => {
                let _ = self.inbox_tx.send(ServerMessage::InkUndo {
                    peer: viewer,
                    doc_path,
                    block_hash,
                    in_reply_to: None,
                });
            }
            RelayToHost::InkClear {
                viewer,
                doc_path,
                block_hash,
            } => {
                let _ = self.inbox_tx.send(ServerMessage::InkClear {
                    peer: viewer,
                    doc_path,
                    block_hash,
                    in_reply_to: None,
                });
            }
            RelayToHost::Shared { .. } | RelayToHost::Ping | RelayToHost::Error { .. } => {}
        }
    }

    /// The host as its own tab sees it in presence.
    fn host_peer(&self) -> Peer {
        Peer {
            id: HOST_ID.into(),
            name: self.opts.name.clone(),
            color: color_for(&self.opts.name),
            path: None,
        }
    }

    /// After a resume: the relay's viewers are the share's viewers. A restarted relay
    /// forgot the rest and will never send their `left`.
    fn keep_only(&mut self, present: &[Peer]) {
        let gone: Vec<String> = self
            .viewers
            .keys()
            .filter(|id| !present.iter().any(|p| &p.id == *id))
            .cloned()
            .collect();
        if gone.is_empty() {
            return;
        }
        tracing::info!(share = %self.id, gone = gone.len(), "dropping viewers the relay no longer has");
        for id in gone {
            self.drop_viewer(&id);
        }
        self.publish_viewers();
    }

    fn drop_viewer(&mut self, viewer: &str) {
        if let Some(v) = self.viewers.remove(viewer) {
            v.task.abort();
            self.opts.engine.disconnect(v.sid);
        }
    }

    /// The socket went: fetches die with it (the relay forgets them); viewer messages
    /// already queued stay for the next link.
    fn link_lost(&mut self) {
        let _ = self.status_tx.send(LinkStatus::Reconnecting);
        tracing::warn!(share = %self.id, "lost the relay; reconnecting");
        for (_, f) in self.fetches.drain() {
            f.task.abort();
        }
        while let Ok(out) = self.out_rx.try_recv() {
            if let Out::Viewer(m) = out {
                self.pending.push(m);
            }
        }
    }

    /// Tries again with backoff until it gets back in, `end()`, or the relay says no.
    async fn reconnect(&mut self) -> Option<Ws> {
        let mut attempt = 0usize;
        loop {
            let delay = Duration::from_secs(BACKOFF[attempt.min(BACKOFF.len() - 1)]);
            attempt += 1;
            let wait = tokio::time::sleep(delay);
            tokio::pin!(wait);
            loop {
                tokio::select! {
                    _ = &mut wait => break,
                    cmd = self.cmd_rx.recv() => match cmd {
                        Some(Cmd::Path(path)) => self.path = path,
                        Some(Cmd::Slide(slide)) => self.slide = slide,
                        Some(Cmd::Stage(stage)) => self.stage = stage,
                        // Ink is not kept for a link that is away.
                        Some(
                            Cmd::Ink(_) | Cmd::Inking(_) | Cmd::InkUndo { .. } | Cmd::InkClear { .. },
                        ) => {}
                        Some(Cmd::End) | None => {
                            let _ = self.status_tx.send(LinkStatus::Ended);
                            return None;
                        }
                    },
                }
            }
            let resume = leaf_protocol::relay::Resume {
                id: self.id.clone(),
                host_key: self.host_key.clone(),
            };
            match open_link(&self.opts, Some(resume)).await {
                Ok((mut ws, shared)) => {
                    self.keep_only(&shared.viewers);
                    let capable = has_presence(&shared.capabilities);
                    self.presence.store(capable, Ordering::Relaxed);
                    if !self.resend(&mut ws, capable).await {
                        continue;
                    }
                    tracing::info!(share = %self.id, "back on the relay");
                    let _ = self.status_tx.send(LinkStatus::Connected);
                    return Some(ws);
                }
                Err(Refused::Final(m)) => {
                    tracing::warn!(share = %self.id, message = %m, "the relay won't take the share back");
                    let _ = self.status_tx.send(LinkStatus::Ended);
                    return None;
                }
                Err(Refused::Retry(m)) => {
                    tracing::info!(share = %self.id, attempt, message = %m, "relay still away");
                }
            }
        }
    }

    /// After a resume: tells the relay the host's path, slide and stage again (the last two
    /// only if the relay takes them). False if the socket failed.
    async fn resend(&self, ws: &mut Ws, capable: bool) -> bool {
        let mut msgs = Vec::new();
        if self.path.is_some() {
            msgs.push(text(&HostToRelay::Path {
                path: self.path.clone(),
            }));
        }
        if capable {
            if self.slide.is_some() {
                msgs.push(text(&HostToRelay::Slide {
                    slide: self.slide.clone(),
                }));
            }
            if self.stage.is_some() {
                msgs.push(text(&HostToRelay::Stage {
                    stage: self.stage.clone(),
                }));
            }
        }
        for m in msgs {
            if ws.send(m).await.is_err() {
                return false;
            }
        }
        true
    }

    /// The share is over: every viewer session and task goes.
    fn finish(mut self) {
        for (_, f) in self.fetches.drain() {
            f.task.abort();
        }
        let ids: Vec<String> = self.viewers.keys().cloned().collect();
        for id in ids {
            self.drop_viewer(&id);
        }
        self.publish_viewers();
        // The host's tab hears presence only from here: tell it nobody is left, or it
        // keeps the last viewers' avatars after the share ends.
        let _ = self.inbox_tx.send(ServerMessage::Presence {
            host: self.host_peer(),
            host_path: None,
            viewers: Vec::new(),
            you: HOST_ID.into(),
            slide: None,
            stage: None,
            in_reply_to: None,
        });
        let _ = self.status_tx.send(LinkStatus::Ended);
    }
}

fn to_viewer(viewer: &str, msg: Value) -> Message {
    text(&HostToRelay::ToViewer {
        viewer: viewer.to_string(),
        msg,
    })
}

/// A path that leaves the root: `..` anywhere, or absolute (a drive letter included).
fn escapes(path: &str) -> bool {
    let b = path.as_bytes();
    let drive =
        b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && matches!(b[2], b'/' | b'\\');
    path.starts_with('/')
        || path.starts_with('\\')
        || path.split(['/', '\\']).any(|c| c == "..")
        || drive
}

fn path_of(msg: &ClientMessage) -> Option<&str> {
    match msg {
        ClientMessage::List { path, .. } => path.as_deref(),
        ClientMessage::Read { path, .. }
        | ClientMessage::Subscribe { path, .. }
        | ClientMessage::Unsubscribe { path, .. }
        | ClientMessage::Blame { path, .. } => Some(path),
        _ => None,
    }
}

/// One viewer's messages, in order, through its own engine session.
async fn serve_viewer(
    engine: Arc<Engine>,
    mode: ShareMode,
    git: Arc<AtomicBool>,
    sid: SessionId,
    viewer: String,
    mut inbox: mpsc::UnboundedReceiver<Value>,
    out: mpsc::Sender<Out>,
) {
    while let Some(msg) = inbox.recv().await {
        let git = git.load(Ordering::Relaxed);
        let (replies, forbidden) = answer(&engine, mode, git, sid, msg).await;
        for reply in replies {
            if out
                .send(Out::Viewer(to_viewer(&viewer, reply)))
                .await
                .is_err()
            {
                return;
            }
        }
        if forbidden {
            tracing::warn!(%viewer, "viewer asked for a path outside the share; ending it");
            let ended =
                json!({"type": "shareStatus", "state": "ended", "reason": "forbidden-path"});
            let _ = out.send(Out::Viewer(to_viewer(&viewer, ended))).await;
            engine.disconnect(sid);
            return;
        }
    }
}

/// The replies to one viewer message, and whether it reached outside the share (an
/// escaping path; an ignored one is only not found). Without `git`, a file's last commit
/// is left out and blame is refused: the host's history stays with the host.
async fn answer(
    engine: &Engine,
    mode: ShareMode,
    git: bool,
    sid: SessionId,
    msg: Value,
) -> (Vec<Value>, bool) {
    let reply_to = msg.get("id").and_then(Value::as_str).map(str::to_string);
    let refuse = |code: ErrorCode, message: &str, path: Option<&str>| {
        serde_json::to_value(
            ServerMessage::error(code, message, path.map(str::to_string))
                .in_reply_to(reply_to.as_deref()),
        )
        .unwrap_or(Value::Null)
    };
    if msg.get("type").and_then(Value::as_str) == Some("preferences") {
        tracing::debug!(client = sid.0, "viewer preferences dropped");
        return (vec![], false);
    }
    let kind = msg.get("type").and_then(Value::as_str).unwrap_or("");
    if !allowed(&msg, mode) || (kind == "blame" && !git) {
        tracing::info!(client = sid.0, kind, "viewer message not allowed");
        let reply = refuse(ErrorCode::BadRequest, "not allowed in a shared tab", None);
        return (vec![reply], false);
    }
    let parsed: ClientMessage = match serde_json::from_value(msg) {
        Ok(m) => m,
        Err(e) => {
            let reply = refuse(
                ErrorCode::BadRequest,
                &format!("invalid message: {e}"),
                None,
            );
            return (vec![reply], false);
        }
    };
    if let Some(path) = path_of(&parsed) {
        if escapes(path) {
            let reply = refuse(
                ErrorCode::OutsideRoot,
                &format!("path escapes the share: {path}"),
                Some(path),
            );
            return (vec![reply], true);
        }
        let clean: Vec<&str> = path
            .split('/')
            .filter(|c| !c.is_empty() && *c != ".")
            .collect();
        // Ignored reads like missing: no expel, since the page would only reconnect and
        // ask again, and the reader itself asks for ignored data files.
        if engine.source().hides(&clean.join("/")) {
            let reply = refuse(
                ErrorCode::NotFound,
                &format!("no such file: {path}"),
                Some(path),
            );
            return (vec![reply], false);
        }
    }
    let mut forbidden = false;
    let replies = engine
        .handle(sid, parsed)
        .await
        .into_iter()
        .map(|reply| {
            let mut v = serde_json::to_value(&reply).unwrap_or(Value::Null);
            match &reply {
                ServerMessage::Welcome { .. } => {
                    if let Some(obj) = v.as_object_mut() {
                        obj.remove("preferences");
                    }
                }
                ServerMessage::File { .. } if !git => {
                    if let Some(obj) = v.as_object_mut() {
                        obj.remove("git");
                    }
                }
                ServerMessage::Error {
                    code: ErrorCode::OutsideRoot,
                    ..
                } => forbidden = true,
                _ => {}
            }
            v
        })
        .collect();
    (replies, forbidden)
}

/// One raw fetch: the head, then the bytes in frames, then an empty frame. Waits while
/// the relay has it paused; the link aborts it on `cancel` or when the socket goes.
async fn serve_fetch(
    engine: Arc<Engine>,
    req: u32,
    path: String,
    range: Option<String>,
    mut paused: watch::Receiver<bool>,
    out: mpsc::Sender<Out>,
) {
    let frame = |bytes: &[u8]| {
        let mut b = Vec::with_capacity(4 + bytes.len());
        b.extend_from_slice(&req.to_be_bytes());
        b.extend_from_slice(bytes);
        Out::Fetch(Message::Binary(b.into()))
    };
    let head = |status: u16, headers: Vec<(String, String)>| {
        Out::Fetch(text(&HostToRelay::Fetched {
            req,
            status,
            headers,
        }))
    };
    let opened = match engine.source().locate(&path).await {
        Ok(abs) => crate::raw::open(&abs, &path, range.as_deref()).await,
        Err(e) => {
            tracing::debug!(req, %path, error = %e, "raw fetch refused");
            let _ = out.send(head(404, vec![])).await;
            let _ = out.send(frame(&[])).await;
            return;
        }
    };
    let mut headers: Vec<(String, String)> = opened
        .headers
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect();
    headers.push(("Content-Length".into(), opened.remaining.to_string()));
    if out.send(head(opened.status, headers)).await.is_err() {
        return;
    }
    if let Some(file) = opened.file {
        let mut file = file.take(opened.remaining);
        let mut buf = vec![0u8; CHUNK_BYTES];
        loop {
            if paused.wait_for(|p| !*p).await.is_err() {
                return;
            }
            let n = match file.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    tracing::warn!(req, %path, error = %e, "raw fetch read failed");
                    return;
                }
            };
            if out.send(frame(&buf[..n])).await.is_err() {
                return;
            }
        }
    }
    let _ = out.send(frame(&[])).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_url_follows_the_relay_scheme() {
        assert_eq!(host_url("https://r.example/"), "wss://r.example/host");
        assert_eq!(host_url("http://127.0.0.1:9"), "ws://127.0.0.1:9/host");
    }

    impl ShareHandle {
        /// A handle with no link behind it: the commands it would send come out of the
        /// returned receiver.
        fn for_test(presence: bool) -> (ShareHandle, mpsc::UnboundedReceiver<Cmd>) {
            let (cmds, rx) = mpsc::unbounded_channel();
            let (_, viewers) = watch::channel(Vec::new());
            let (_, status) = watch::channel(LinkStatus::Connected);
            let handle = ShareHandle {
                id: "t".into(),
                host_key: "k".into(),
                web_url: String::new(),
                app_url: String::new(),
                viewers,
                status,
                cmds,
                pointer: watch::channel(None).0,
                git: Arc::new(AtomicBool::new(false)),
                presence: Arc::new(AtomicBool::new(presence)),
                inbox: Mutex::new(None),
            };
            (handle, rx)
        }
    }

    #[test]
    fn a_relay_without_presence_keeps_the_host_quiet() {
        let slide = || {
            Some(Slide {
                path: "d.md".into(),
                index: 1,
            })
        };
        let stroke = || Stroke {
            id: "host:1".into(),
            doc_path: "a.mmd".into(),
            block_hash: "h".into(),
            points: vec![[0.0, 0.0], [1.0, 1.0]],
            color: "red".into(),
            width: 2.0,
            sticky: true,
            created_at: 0.0,
        };
        let (quiet, mut rx) = ShareHandle::for_test(false);
        quiet.set_slide(slide());
        quiet.set_stage(None);
        quiet.pointer(Some(PointerAt {
            doc_path: "a.mmd".into(),
            block_hash: "h".into(),
            x: 1.0,
            y: 2.0,
        }));
        quiet.ink(stroke());
        quiet.inking(stroke());
        quiet.ink_undo("a.mmd".into(), "h".into());
        quiet.ink_clear("a.mmd".into(), "h".into());
        assert!(rx.try_recv().is_err(), "nothing is sent");
        assert!(quiet.pointer.borrow().is_none(), "no pointer is pending");
        let (loud, mut rx) = ShareHandle::for_test(true);
        loud.set_slide(slide());
        assert!(matches!(rx.try_recv(), Ok(Cmd::Slide(Some(_)))));
        loud.ink(stroke());
        assert!(matches!(rx.try_recv(), Ok(Cmd::Ink(s)) if s.id == "host:1"));
        assert!(rx.try_recv().is_err(), "one command per stroke");
        loud.inking(stroke());
        assert!(matches!(rx.try_recv(), Ok(Cmd::Inking(s)) if s.id == "host:1"));
    }

    #[test]
    fn escaping_paths_are_caught() {
        for p in [
            "../x.md",
            "a/../../x",
            "/etc/passwd",
            "\\x",
            "a\\..\\b",
            "C:/x",
            "c:\\x",
        ] {
            assert!(escapes(p), "{p}");
        }
        for p in ["", "README.md", "pics/a.png", "a..b.md", "a:notes.md"] {
            assert!(!escapes(p), "{p}");
        }
    }
}
