//! The relay's shares: one host link and its viewers each, and every change to them.
//!
//! All state sits behind one lock and every transition is synchronous. Sockets are fed
//! through bounded queues with `try_send`, so nothing awaits while the lock is held and
//! frames meant for the host keep their order. A socket whose queue is full is not kept
//! waiting for: a viewer is dropped (as if it left), and a host is treated as dropped
//! (its share goes into grace).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message};
use leaf_protocol::relay::{Peer, RelayToHost, Resume, ShareInfo, ShareMode};
use leaf_protocol::{ServerMessage, ShareState};
use serde_json::Value;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::limits::Limits;
use super::{hostkey, urls, words};

/// The host's peer id in presence and share info.
pub const HOST_ID: &str = "host";
/// Frames kept per viewer while the host is away; older ones are dropped.
pub const BUFFER_PER_VIEWER: usize = 64;
/// Frames waiting to go out on one socket; a socket that falls this far behind is dropped.
pub const QUEUE_FRAMES: usize = 256;
/// Viewers one share takes; the next is refused.
pub const MAX_VIEWERS: usize = 100;
/// Raw fetches one share runs at once; the next is refused.
pub const MAX_FETCHES: usize = 8;
/// Chunks of a fetch's body waiting for its HTTP client, at most. The host is asked to
/// `pause` well before this; a host that keeps sending anyway is cut off here (`cancel`)
/// rather than stalling the host link for everyone.
pub const FETCH_CHUNKS: usize = 64;
/// Chunks waiting when the relay asks the host to `pause` a fetch.
pub const PAUSE_AT: usize = 24;
/// Chunks waiting, at most, when the relay lets a paused fetch `resume`.
pub const RESUME_AT: usize = 8;

/// Peer colors: twelve hues that read on light and dark pages (Tailwind's 500s).
pub const PALETTE: [&str; 12] = [
    "#ef4444", // red
    "#f97316", // orange
    "#f59e0b", // amber
    "#84cc16", // lime
    "#10b981", // emerald
    "#14b8a6", // teal
    "#06b6d4", // cyan
    "#3b82f6", // blue
    "#6366f1", // indigo
    "#8b5cf6", // violet
    "#d946ef", // fuchsia
    "#ec4899", // pink
];

/// A name's color: the same name always gets the same one (FNV-1a over its bytes).
pub fn color_for(name: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in name.bytes() {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    PALETTE[h as usize % PALETTE.len()].to_string()
}

/// A name for a viewer who gave none: two capitalized words, "Brisk Otter".
pub fn auto_name() -> String {
    let id = words::new_id(&mut rand::rng());
    id.split('-')
        .take(2)
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_ascii_uppercase().to_string() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn text<T: serde::Serialize>(m: &T) -> Message {
    Message::Text(serde_json::to_string(m).unwrap_or_default().into())
}

/// Queues `m`; false only when the queue is full. A closed queue is a socket already
/// ending, whose task will report it.
fn offer(tx: &Sender<Message>, m: Message) -> bool {
    !matches!(tx.try_send(m), Err(TrySendError::Full(_)))
}

/// Why a host's `share` was refused: the `RelayToHost::Error` to send before closing.
pub struct Refused {
    pub code: &'static str,
    pub message: String,
}

/// A host's `share`, accepted: the host task sends `shared` and then `replay` (what its
/// viewers said while it was away) before anything queued for it.
pub struct Accepted {
    pub id: String,
    pub shared: Message,
    pub replay: Vec<String>,
}

/// Why a viewer couldn't join after its hello.
#[derive(Debug, PartialEq, Eq)]
pub enum JoinRefused {
    Gone,
    Full,
}

/// What the host says a fetch's reply is: its status and headers.
pub type Head = (u16, Vec<(String, String)>);

/// Why a raw fetch wasn't started.
#[derive(Debug, PartialEq, Eq)]
pub enum FetchRefused {
    /// No such share (or it ended).
    Gone,
    /// The host is away; the share is in grace.
    Away,
    /// The share already runs `MAX_FETCHES`.
    Busy,
}

/// A started fetch, for the HTTP handler: the head comes on `head`, then the body chunks
/// on `body`. When `body` closes, `complete` says whether the host finished it. While
/// `paused`, the reader calls `fetch_drained` once it is down to `RESUME_AT` chunks.
pub struct Started {
    pub req: u32,
    pub head: oneshot::Receiver<Head>,
    pub body: mpsc::Receiver<Bytes>,
    pub complete: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
}

/// One raw fetch in flight. Dropping it drops the body's sender, which ends the body;
/// unless `complete` was set first, the HTTP client sees an error.
struct Fetch {
    head: Option<oneshot::Sender<Head>>,
    body: Sender<Bytes>,
    complete: Arc<AtomicBool>,
    /// The host was told to `pause`; set under the lock, read by the body's reader.
    paused: Arc<AtomicBool>,
}

struct Viewer {
    seq: u64,
    peer: Peer,
    tx: Sender<Message>,
}

pub struct Share {
    host: Option<Sender<Message>>,
    /// Which host connection owns this share (the one live now, or the one that dropped).
    host_conn: u64,
    /// The host's queue overflowed; the share goes into grace when the change settles.
    host_full: bool,
    viewers: HashMap<String, Viewer>,
    /// Frames for the host from each viewer while it is away, replayed on resume.
    buffered: HashMap<String, VecDeque<String>>,
    info: ShareInfo,
    host_path: Option<String>,
    grace_timer: Option<JoinHandle<()>>,
    /// Raw fetches waiting on the host, by `req`.
    fetches: HashMap<u32, Fetch>,
    next_req: u32,
}

impl Share {
    fn for_host(&mut self, viewer: &str, msg: &RelayToHost) {
        let mut frame = serde_json::to_string(msg).unwrap_or_default();
        if let Some(tx) = self.host.as_ref().filter(|_| !self.host_full) {
            match tx.try_send(Message::Text(frame.into())) {
                Ok(()) => return,
                Err(TrySendError::Full(m)) => {
                    self.host_full = true;
                    frame = m.into_text().map(|t| t.to_string()).unwrap_or_default();
                }
                // The host task is ending and will report the drop.
                Err(TrySendError::Closed(m)) => {
                    frame = m.into_text().map(|t| t.to_string()).unwrap_or_default();
                }
            }
        }
        // The host is away, or about to be: keep the frame for its return.
        let q = self.buffered.entry(viewer.to_string()).or_default();
        if q.len() == BUFFER_PER_VIEWER {
            q.pop_front();
        }
        q.push_back(frame);
    }

    /// Sends the host a fetch's `Fetch` or `Cancel`. A full queue marks the host behind;
    /// the share goes into grace when the change settles, which ends every fetch anyway.
    fn fetch_message(&mut self, msg: &RelayToHost) {
        if let Some(tx) = &self.host
            && !offer(tx, text(msg))
        {
            self.host_full = true;
        }
    }

    fn peers(&self) -> Vec<Peer> {
        let mut v: Vec<&Viewer> = self.viewers.values().collect();
        v.sort_by_key(|v| v.seq);
        v.into_iter().map(|v| v.peer.clone()).collect()
    }

    /// Sends everyone presence; returns the viewers whose queues were full.
    fn presence(&self) -> Vec<String> {
        let viewers = self.peers();
        let mut full = Vec::new();
        for (id, v) in &self.viewers {
            let m = text(&ServerMessage::Presence {
                host: self.info.host.clone(),
                host_path: self.host_path.clone(),
                viewers: viewers.clone(),
                you: id.clone(),
                in_reply_to: None,
            });
            if !offer(&v.tx, m) {
                full.push(id.clone());
            }
        }
        full
    }

    fn status(&self, state: ShareState, reason: Option<&str>) -> Vec<String> {
        self.viewers
            .iter()
            .filter(|(_, v)| !offer(&v.tx, status(state, reason)))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Tells every viewer the share ended and closes them. A viewer whose queue is full
    /// misses the notice; its channel closes when the share is dropped, which ends it too.
    fn close_all(mut self, reason: &str) {
        if let Some(t) = self.grace_timer.take() {
            t.abort();
        }
        for v in self.viewers.values() {
            let _ = offer(&v.tx, status(ShareState::Ended, Some(reason)))
                && offer(&v.tx, Message::Close(None));
        }
        if let Some(h) = &self.host {
            let _ = offer(h, Message::Close(None));
        }
    }
}

fn status(state: ShareState, reason: Option<&str>) -> Message {
    text(&ServerMessage::ShareStatus {
        state,
        reason: reason.map(str::to_string),
        in_reply_to: None,
    })
}

fn viewer_seq(id: &str) -> u64 {
    id.strip_prefix('v')
        .and_then(|n| n.parse().ok())
        .unwrap_or(u64::MAX)
}

pub struct Relay {
    shares: Mutex<HashMap<String, Share>>,
    pub secret: Vec<u8>,
    pub grace: Duration,
    /// Where viewers reach this relay, without a trailing '/'.
    pub public_url: String,
    pub max_viewers: usize,
    pub limits: Limits,
    next_viewer: AtomicU64,
    next_conn: AtomicU64,
}

impl Relay {
    pub fn new(secret: Vec<u8>, grace: Duration, public_url: String, max_viewers: usize) -> Relay {
        Relay {
            shares: Mutex::new(HashMap::new()),
            secret,
            grace,
            public_url,
            max_viewers,
            limits: Limits::default(),
            next_viewer: AtomicU64::new(1),
            next_conn: AtomicU64::new(1),
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Share>> {
        self.shares.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A fresh id for one host connection.
    pub fn new_conn(&self) -> u64 {
        self.next_conn.fetch_add(1, Ordering::Relaxed)
    }

    /// Whether `id` is live or waiting for its host.
    pub fn exists(&self, id: &str) -> bool {
        self.lock().contains_key(id)
    }

    /// Finishes a change: drops viewers whose queues were full (telling the host and the
    /// rest), and puts the share into grace if the host's queue overflowed.
    fn settle(self: &Arc<Self>, id: &str, share: &mut Share, mut full: Vec<String>) {
        loop {
            if share.host_full {
                share.host_full = false;
                if share.host.is_some() {
                    tracing::warn!(share = %id, "host fell behind; treating it as dropped");
                    full.extend(self.begin_grace(id, share));
                }
            }
            if full.is_empty() {
                break;
            }
            for vid in full.drain(..) {
                if share.viewers.remove(&vid).is_some() {
                    tracing::warn!(share = %id, viewer = %vid, "viewer fell behind; dropped");
                    share.for_host(
                        &vid,
                        &RelayToHost::Left {
                            viewer: vid.clone(),
                        },
                    );
                }
            }
            full = share.presence();
        }
    }

    /// The host is gone: viewers hear `reconnecting` and wait `grace` for it.
    /// Returns the viewers whose queues were full.
    fn begin_grace(self: &Arc<Self>, id: &str, share: &mut Share) -> Vec<String> {
        share.host = None;
        // A returning host knows nothing of these: their clients get an error.
        share.fetches.clear();
        let relay = Arc::clone(self);
        let grace = self.grace;
        let key = id.to_string();
        let conn = share.host_conn;
        if let Some(t) = share.grace_timer.replace(tokio::spawn(async move {
            tokio::time::sleep(grace).await;
            relay.grace_over(&key, conn);
        })) {
            t.abort();
        }
        tracing::info!(share = %id, grace_ms = grace.as_millis() as u64, "host away; waiting");
        share.status(ShareState::Reconnecting, None)
    }

    /// A host's `share`: a new share, or the resume of one (in grace, or lost to a restart).
    pub fn share(
        self: &Arc<Self>,
        conn: u64,
        tx: Sender<Message>,
        name: &str,
        mode: ShareMode,
        resume: Option<Resume>,
    ) -> Result<Accepted, Refused> {
        let bad_key = || Refused {
            code: "bad-key",
            message: "this share's key doesn't match; share again for a new link".into(),
        };
        let host = Peer {
            id: HOST_ID.into(),
            name: name.to_string(),
            color: color_for(name),
        };
        let mut shares = self.lock();
        let id = match resume {
            Some(Resume { id, host_key }) => {
                if !hostkey::verify(&self.secret, &id, &host_key) {
                    return Err(bad_key());
                }
                id
            }
            None => loop {
                let id = words::new_id(&mut rand::rng());
                if !shares.contains_key(&id) {
                    break id;
                }
            },
        };
        let (web_url, app_url) = urls(&self.public_url, &id);
        let mut replay = Vec::new();
        let mut viewers = Vec::new();
        match shares.get_mut(&id) {
            Some(share) => {
                if let Some(t) = share.grace_timer.take() {
                    t.abort();
                }
                // The key proves it's the same host, back before the relay saw its old
                // link drop (a network change, say): the new link takes over.
                let replacing = share.host.take();
                if let Some(old) = &replacing {
                    let _ = offer(old, Message::Close(None));
                    tracing::info!(share = %id, "host came back on a new link; the old one is closed");
                }
                share.host_full = false;
                share.host_conn = conn;
                share.info.host = host;
                share.info.mode = mode;
                // The new host knows nothing of these: their clients get an error.
                share.fetches.clear();
                let mut queued: Vec<(String, VecDeque<String>)> = share.buffered.drain().collect();
                queued.sort_by_key(|(v, _)| viewer_seq(v));
                replay = queued.into_iter().flat_map(|(_, q)| q).collect();
                share.host = Some(tx);
                viewers = share.peers();
                if replacing.is_none() {
                    let mut full = share.status(ShareState::Live, None);
                    full.extend(share.presence());
                    tracing::info!(share = %id, viewers = share.viewers.len(), "host resumed");
                    self.settle(&id, share, full);
                }
            }
            None => {
                shares.insert(
                    id.clone(),
                    Share {
                        host: Some(tx),
                        host_conn: conn,
                        host_full: false,
                        viewers: HashMap::new(),
                        buffered: HashMap::new(),
                        info: ShareInfo {
                            id: id.clone(),
                            host,
                            mode,
                            web_url: web_url.clone(),
                            app_url: app_url.clone(),
                        },
                        host_path: None,
                        grace_timer: None,
                        fetches: HashMap::new(),
                        next_req: 1,
                    },
                );
                tracing::info!(share = %id, "shared");
            }
        }
        let shared = text(&RelayToHost::Shared {
            id: id.clone(),
            host_key: hostkey::host_key(&self.secret, &id),
            web_url,
            app_url,
            viewers,
        });
        Ok(Accepted { id, shared, replay })
    }

    /// The host's `toViewer`: patch a welcome, deliver, and expel on a per-viewer `ended`.
    pub fn to_viewer(self: &Arc<Self>, id: &str, conn: u64, viewer: &str, mut msg: Value) {
        let mut shares = self.lock();
        let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) else {
            return;
        };
        let Some(v) = share.viewers.get(viewer) else {
            tracing::debug!(share = %id, viewer, "message for a viewer who left dropped");
            return;
        };
        let ty = msg
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if ty == "welcome"
            && let Some(obj) = msg.as_object_mut()
        {
            obj.insert(
                "share".into(),
                serde_json::to_value(&share.info).unwrap_or(Value::Null),
            );
            obj.remove("preferences");
            let caps = obj
                .entry("capabilities")
                .or_insert_with(|| Value::Object(Default::default()));
            if let Some(caps) = caps.as_object_mut() {
                caps.insert("rawUrls".into(), Value::Bool(true));
                caps.insert(
                    "rawBase".into(),
                    Value::String(format!("{}/s/{id}/raw/", self.public_url)),
                );
            }
        }
        let expel =
            ty == "shareStatus" && msg.get("state").and_then(Value::as_str) == Some("ended");
        let delivered = offer(&v.tx, text(&msg));
        if expel {
            let _ = delivered && offer(&v.tx, Message::Close(None));
            share.viewers.remove(viewer);
            tracing::info!(share = %id, viewer, "viewer expelled by the host");
            share.for_host(
                viewer,
                &RelayToHost::Left {
                    viewer: viewer.to_string(),
                },
            );
            let full = share.presence();
            self.settle(id, share, full);
        } else if !delivered {
            self.settle(id, share, vec![viewer.to_string()]);
        }
    }

    /// The host's `path`: what it is reading now.
    pub fn path(self: &Arc<Self>, id: &str, conn: u64, path: Option<String>) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.host_path = path;
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// The host's `end`: viewers are told and closed; the id is free at once.
    pub fn end(&self, id: &str, conn: u64) {
        let mut shares = self.lock();
        if shares.get(id).is_some_and(|s| s.host_conn == conn)
            && let Some(share) = shares.remove(id)
        {
            tracing::info!(share = %id, "ended by the host");
            share.close_all("host");
        }
    }

    /// The host link dropped without `end`. Nothing to do when this connection no longer
    /// owns the share, or its share is already in grace (its queue overflowed).
    pub fn host_dropped(self: &Arc<Self>, id: &str, conn: u64) {
        let mut shares = self.lock();
        let Some(share) = shares
            .get_mut(id)
            .filter(|s| s.host_conn == conn && s.host.is_some())
        else {
            return;
        };
        let full = self.begin_grace(id, share);
        self.settle(id, share, full);
    }

    fn grace_over(&self, id: &str, conn: u64) {
        let mut shares = self.lock();
        if shares
            .get(id)
            .is_some_and(|s| s.host.is_none() && s.host_conn == conn)
            && let Some(mut share) = shares.remove(id)
        {
            // This is the timer's own task: let it finish rather than abort it.
            share.grace_timer.take();
            tracing::info!(share = %id, "host did not come back; share ended");
            share.close_all("host-gone");
        }
    }

    /// A viewer said hello: it gets an id, the host hears `joined` and the hello itself.
    pub fn join(
        self: &Arc<Self>,
        id: &str,
        name: Option<String>,
        hello: Value,
        tx: Sender<Message>,
    ) -> Result<String, JoinRefused> {
        let mut shares = self.lock();
        let share = shares.get_mut(id).ok_or(JoinRefused::Gone)?;
        if share.viewers.len() >= self.max_viewers {
            tracing::warn!(share = %id, viewers = share.viewers.len(), "viewer refused: share is full");
            return Err(JoinRefused::Full);
        }
        let seq = self.next_viewer.fetch_add(1, Ordering::Relaxed);
        let vid = format!("v{seq}");
        let name = name.unwrap_or_else(auto_name);
        let peer = Peer {
            id: vid.clone(),
            color: color_for(&name),
            name,
        };
        share.for_host(
            &vid,
            &RelayToHost::Joined {
                viewer: vid.clone(),
                name: peer.name.clone(),
                color: peer.color.clone(),
            },
        );
        share.for_host(
            &vid,
            &RelayToHost::FromViewer {
                viewer: vid.clone(),
                msg: hello,
            },
        );
        // A fresh queue: these can't overflow.
        if share.host.is_none() {
            let _ = offer(&tx, status(ShareState::Reconnecting, None));
        }
        share.viewers.insert(vid.clone(), Viewer { seq, peer, tx });
        tracing::info!(share = %id, viewer = %vid, viewers = share.viewers.len(), "viewer joined");
        let full = share.presence();
        self.settle(id, share, full);
        Ok(vid)
    }

    /// A viewer's message, for the host (or its buffer while the host is away).
    pub fn from_viewer(self: &Arc<Self>, id: &str, viewer: &str, msg: Value) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share.viewers.contains_key(viewer)
        {
            share.for_host(
                viewer,
                &RelayToHost::FromViewer {
                    viewer: viewer.to_string(),
                    msg,
                },
            );
            self.settle(id, share, Vec::new());
        }
    }

    /// A viewer's socket closed. Nothing to do when it was already dropped or the share ended.
    pub fn viewer_left(self: &Arc<Self>, id: &str, viewer: &str) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share.viewers.contains_key(viewer)
        {
            share.viewers.remove(viewer);
            share.for_host(
                viewer,
                &RelayToHost::Left {
                    viewer: viewer.to_string(),
                },
            );
            tracing::info!(share = %id, viewer, viewers = share.viewers.len(), "viewer left");
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// A viewer's `GET /s/{id}/raw/{path}`: asks the host for the bytes.
    pub fn start_fetch(
        self: &Arc<Self>,
        id: &str,
        path: String,
        range: Option<String>,
    ) -> Result<Started, FetchRefused> {
        let mut shares = self.lock();
        let share = shares.get_mut(id).ok_or(FetchRefused::Gone)?;
        if share.host.is_none() {
            return Err(FetchRefused::Away);
        }
        if share.fetches.len() >= MAX_FETCHES {
            tracing::warn!(share = %id, "raw fetch refused: too many at once");
            return Err(FetchRefused::Busy);
        }
        let req = loop {
            let req = share.next_req;
            share.next_req = share.next_req.wrapping_add(1);
            if !share.fetches.contains_key(&req) {
                break req;
            }
        };
        let (head_tx, head) = oneshot::channel();
        let (body_tx, body) = mpsc::channel(FETCH_CHUNKS);
        let complete = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicBool::new(false));
        share.fetches.insert(
            req,
            Fetch {
                head: Some(head_tx),
                body: body_tx,
                complete: complete.clone(),
                paused: paused.clone(),
            },
        );
        tracing::debug!(share = %id, req, %path, ?range, "raw fetch");
        share.fetch_message(&RelayToHost::Fetch { req, path, range });
        self.settle(id, share, Vec::new());
        Ok(Started {
            req,
            head,
            body,
            complete,
            paused,
        })
    }

    /// The host's `fetched`: the status and headers for `req`'s reply.
    pub fn fetched(&self, id: &str, conn: u64, req: u32, head: Head) {
        let mut shares = self.lock();
        if let Some(fetch) = shares
            .get_mut(id)
            .filter(|s| s.host_conn == conn)
            .and_then(|s| s.fetches.get_mut(&req))
            && let Some(tx) = fetch.head.take()
        {
            let _ = tx.send(head);
        }
    }

    /// A binary frame from the host: bytes for `req`'s body, or (empty) its end. Frames
    /// for a `req` that isn't open (a cancelled fetch's tail) are dropped.
    pub fn fetch_bytes(self: &Arc<Self>, id: &str, conn: u64, req: u32, bytes: Bytes) {
        let mut shares = self.lock();
        let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) else {
            return;
        };
        let Some(fetch) = share.fetches.get(&req) else {
            return;
        };
        if bytes.is_empty() {
            fetch.complete.store(true, Ordering::Release);
            share.fetches.remove(&req);
            return;
        }
        // Pause before this chunk goes in, so the reader that takes it sees the flag.
        let waiting = FETCH_CHUNKS - fetch.body.capacity() + 1;
        if waiting >= PAUSE_AT && !fetch.paused.swap(true, Ordering::AcqRel) {
            tracing::debug!(share = %id, req, waiting, "raw client behind; host paused");
            share.fetch_message(&RelayToHost::Pause { req });
        }
        let Some(fetch) = share.fetches.get(&req) else {
            return;
        };
        match fetch.body.try_send(bytes) {
            Ok(()) => self.settle(id, share, Vec::new()),
            Err(e) => {
                if matches!(e, TrySendError::Full(_)) {
                    tracing::warn!(share = %id, req, "raw client fell behind; fetch cut off");
                }
                share.fetches.remove(&req);
                share.fetch_message(&RelayToHost::Cancel { req });
                self.settle(id, share, Vec::new());
            }
        }
    }

    /// A paused fetch's reader is down to `RESUME_AT` chunks: the host may go on.
    pub fn fetch_drained(self: &Arc<Self>, id: &str, req: u32) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share
                .fetches
                .get(&req)
                .is_some_and(|f| f.paused.swap(false, Ordering::AcqRel))
        {
            tracing::debug!(share = %id, req, "raw client caught up; host resumed");
            share.fetch_message(&RelayToHost::Resume { req });
            self.settle(id, share, Vec::new());
        }
    }

    /// The HTTP side of `req` is done with it (its client left, or it gave up waiting).
    /// If the host hadn't finished, it hears `cancel`.
    pub fn cancel_fetch(self: &Arc<Self>, id: &str, req: u32) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share.fetches.remove(&req).is_some()
        {
            tracing::debug!(share = %id, req, "raw fetch cancelled");
            share.fetch_message(&RelayToHost::Cancel { req });
            self.settle(id, share, Vec::new());
        }
    }

    /// The relay is stopping: forget every share and cancel the grace timers.
    pub fn shutdown(&self) {
        for (_, mut share) in self.lock().drain() {
            if let Some(t) = share.grace_timer.take() {
                t.abort();
            }
        }
    }
}

/// The close frame for a share id that isn't here.
pub fn unknown_share_close() -> Message {
    Message::Close(Some(CloseFrame {
        code: 4404,
        reason: "unknown share".into(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    fn relay() -> Arc<Relay> {
        Arc::new(Relay::new(
            b"s".to_vec(),
            Duration::from_secs(60),
            "https://r".into(),
            MAX_VIEWERS,
        ))
    }

    fn kind(m: &Message) -> String {
        match m {
            Message::Text(t) => serde_json::from_str::<Value>(t).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string(),
            Message::Close(_) => "close".into(),
            other => format!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn a_viewer_that_falls_behind_is_dropped_and_the_host_told() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        // Room for one frame: the join's presence fills it.
        let (vtx, mut vrx) = mpsc::channel(1);
        let vid = r
            .join(
                &id,
                Some("Ann".into()),
                serde_json::json!({"type": "hello"}),
                vtx,
            )
            .unwrap();
        r.to_viewer(&id, 1, &vid, serde_json::json!({"type": "tree"}));
        let host: Vec<String> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(host, ["joined", "fromViewer", "left"]);
        assert_eq!(kind(&vrx.try_recv().unwrap()), "presence");
        assert!(vrx.try_recv().is_err(), "the viewer's queue is closed");
        r.shutdown();
    }

    #[tokio::test]
    async fn a_host_that_falls_behind_goes_into_grace_and_loses_nothing() {
        let r = relay();
        // Room for one frame: `joined` fits, the hello doesn't.
        let (htx, mut hrx) = mpsc::channel(1);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let (vtx, mut vrx) = mpsc::channel(QUEUE_FRAMES);
        r.join(
            &id,
            Some("Ann".into()),
            serde_json::json!({"type": "hello"}),
            vtx,
        )
        .unwrap();
        assert_eq!(kind(&hrx.try_recv().unwrap()), "joined");
        assert!(hrx.try_recv().is_err(), "the host's queue is closed");
        let viewer: Vec<String> = std::iter::from_fn(|| vrx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(
            viewer,
            ["presence", "shareStatus"],
            "told the host is reconnecting"
        );

        let (htx, _hrx) = mpsc::channel(QUEUE_FRAMES);
        let resume = Resume {
            id: id.clone(),
            host_key: hostkey::host_key(b"s", &id),
        };
        let a = r
            .share(2, htx, "Rob", ShareMode::ReadOnly, Some(resume))
            .ok()
            .unwrap();
        assert_eq!(a.replay.len(), 1);
        assert!(a.replay[0].contains("\"hello\""), "{:?}", a.replay);
        r.shutdown();
    }

    #[tokio::test]
    async fn fetches_are_capped_and_end_with_the_host() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let mut open: Vec<Started> = (0..MAX_FETCHES)
            .map(|_| r.start_fetch(&id, "a.png".into(), None).ok().unwrap())
            .collect();
        assert_eq!(
            r.start_fetch(&id, "a.png".into(), None).err(),
            Some(FetchRefused::Busy)
        );
        assert_eq!(kind(&hrx.try_recv().unwrap()), "fetch");

        // One finishes: its body ends cleanly and makes room.
        let done = open.remove(0);
        r.fetched(&id, 1, done.req, (200, vec![]));
        r.fetch_bytes(&id, 1, done.req, Bytes::from_static(b"ab"));
        r.fetch_bytes(&id, 1, done.req, Bytes::new());
        let mut body = done.body;
        assert_eq!(body.try_recv().unwrap(), &b"ab"[..]);
        assert!(body.recv().await.is_none());
        assert!(done.complete.load(Ordering::Acquire));
        assert_eq!(done.head.await.unwrap().0, 200);
        let extra = r.start_fetch(&id, "b.png".into(), None).ok().unwrap();
        open.push(extra);

        // The host drops: every open fetch ends unfinished.
        r.host_dropped(&id, 1);
        for f in open {
            let mut body = f.body;
            assert!(body.recv().await.is_none());
            assert!(!f.complete.load(Ordering::Acquire));
            assert!(f.head.await.is_err());
        }
        assert_eq!(
            r.start_fetch(&id, "a.png".into(), None).err(),
            Some(FetchRefused::Away)
        );
        r.shutdown();
    }

    #[tokio::test]
    async fn a_host_that_ignores_pause_is_cut_off_and_the_host_told() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let f = r.start_fetch(&id, "v.mp4".into(), None).ok().unwrap();
        for _ in 0..=FETCH_CHUNKS {
            r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        }
        let host: Vec<String> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(host, ["fetch", "pause", "cancel"]);
        let mut body = f.body;
        for _ in 0..FETCH_CHUNKS {
            assert!(body.recv().await.is_some());
        }
        assert!(body.recv().await.is_none());
        assert!(!f.complete.load(Ordering::Acquire));
        r.shutdown();
    }

    #[tokio::test]
    async fn a_fetch_pauses_at_its_mark_and_resumes_once_drained() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let mut f = r.start_fetch(&id, "v.mp4".into(), None).ok().unwrap();
        assert_eq!(kind(&hrx.try_recv().unwrap()), "fetch");
        for _ in 1..PAUSE_AT {
            r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        }
        assert!(hrx.try_recv().is_err(), "no pause below the mark");
        r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        assert_eq!(kind(&hrx.try_recv().unwrap()), "pause");
        assert!(f.paused.load(Ordering::Acquire));
        r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        assert!(hrx.try_recv().is_err(), "pause is sent once");
        while f.body.len() > RESUME_AT {
            f.body.recv().await.unwrap();
        }
        r.fetch_drained(&id, f.req);
        r.fetch_drained(&id, f.req);
        let host: Vec<String> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(host, ["resume"], "resume is sent once");
        r.shutdown();
    }

    #[test]
    fn colors_are_stable_and_from_the_palette() {
        assert_eq!(color_for("Ann"), color_for("Ann"));
        assert!(PALETTE.contains(&color_for("Ann").as_str()));
        let distinct: std::collections::HashSet<String> =
            ["Ann", "Bea", "Cal", "Dee", "Eve", "Fay"]
                .iter()
                .map(|n| color_for(n))
                .collect();
        assert!(distinct.len() > 1);
    }

    #[test]
    fn auto_names_are_two_capitalized_words() {
        let n = auto_name();
        let parts: Vec<&str> = n.split(' ').collect();
        assert_eq!(parts.len(), 2, "{n}");
        for p in parts {
            assert!(words::WORDS.contains(&p.to_lowercase().as_str()), "{n}");
            assert!(p.starts_with(|c: char| c.is_ascii_uppercase()), "{n}");
        }
    }
}
