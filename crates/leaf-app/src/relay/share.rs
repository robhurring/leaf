//! The relay's shares: one host link and its viewers each, and every change to them.
//!
//! All state sits behind one lock and every transition is synchronous. Sockets are fed
//! through bounded queues with `try_send`, so nothing awaits while the lock is held and
//! frames meant for the host keep their order. A socket whose queue is full is not kept
//! waiting for: a viewer is dropped (as if it left), and a host is treated as dropped
//! (its share goes into grace). Only the relay's own frames can put a host there: what a
//! viewer has forwarded is metered, and stops short of the host's last room.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::extract::ws::{CloseFrame, Message};
use leaf_protocol::relay::{Peer, RelayToHost, Resume, ShareInfo, ShareMode};
use leaf_protocol::{PointerAt, ServerMessage, ShareState, Slide, StageRef, Stroke};
use serde_json::Value;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::{Notify, oneshot};
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
/// Raw fetches one share runs at once; the next waits for one of them to end.
pub const MAX_FETCHES: usize = 8;
/// Chunks of a fetch's body waiting for its HTTP client, at most. The host is asked to
/// `pause` well before this; a host that keeps sending anyway is cut off here (`cancel`)
/// rather than stalling the host link for everyone. Between the two marks is room for
/// what a host that obeys has already sent when `pause` reaches it: the 32 chunks of its
/// out-queue and the one in its hand, and as many again in the sockets between.
pub const FETCH_CHUNKS: usize = 96;
/// Chunks waiting when the relay asks the host to `pause` a fetch.
pub const PAUSE_AT: usize = 16;
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

/// Queues `m` for a viewer who can do without it (a pointer, a stroke): when the queue is
/// full it is dropped, and the viewer is neither marked behind nor dropped.
fn offer_drop(tx: &Sender<Message>, m: Message) {
    let _ = tx.try_send(m);
}

/// Most canvases the host's sticky strokes are kept on; its oldest canvas goes first.
pub const MAX_STICKY_CANVASES: usize = 50;
/// Most sticky strokes kept on one canvas, everyone's together.
pub const MAX_STICKY_STROKES: usize = QUEUE_FRAMES / 2;
/// Most points one `inking` frame may carry; a sender adds a few per frame at 20 a second.
pub const MAX_INKING_POINTS: usize = 256;
/// Most points in a viewer's finished stroke; a longer one is dropped.
pub const MAX_STROKE_POINTS: usize = 4096;
/// Most sticky strokes kept per viewer across a share; the viewer's oldest goes first.
pub const MAX_VIEWER_KEPT: usize = 100;

/// A sticky stroke the relay keeps for viewers who arrive later, and who drew it.
#[derive(Debug, Clone)]
struct Kept {
    peer: String,
    /// Its place among the share's kept strokes: a lower one was kept earlier.
    seq: u64,
    stroke: Stroke,
}

/// A canvas: a document's path and a block's hash.
type Canvas = (String, String);
/// A viewer's pointer frames closer together than this are dropped (twenty a second).
pub const POINTER_MIN_GAP: Duration = Duration::from_millis(50);
/// Least time between two `inking` frames from one viewer (a sender makes one per 50 ms).
pub const INKING_MIN_GAP: Duration = Duration::from_millis(30);
/// Least time between two finished strokes from one viewer.
pub const INK_MIN_GAP: Duration = Duration::from_millis(50);
/// Least time between two announcements of where one viewer is (four a second). Its `at`
/// is taken at once; within the gap only the telling waits, and the last place is told.
pub const AT_MIN_GAP: Duration = Duration::from_millis(250);
/// Longest path, block hash or stroke id anyone may name, in bytes.
pub const MAX_PATH_LEN: usize = 1024;
/// Longest name a host or viewer goes by, in characters; a longer one is cut to this.
pub const MAX_NAME_CHARS: usize = 64;
/// Longest stroke color, in bytes (the page sends "red", "green" or "blue").
pub const MAX_COLOR_LEN: usize = 32;
/// Widest stroke, in the block's units (the page draws at a few units).
pub const MAX_STROKE_WIDTH: f64 = 64.0;
/// Most points in a stroke of the host's, finished or in progress: four times a viewer's,
/// and some minutes of unbroken drawing.
pub const MAX_HOST_STROKE_POINTS: usize = 4 * MAX_STROKE_POINTS;
/// Most sticky strokes kept on one document, everyone's together: an arriving viewer is
/// sent them all at once, and they fit its queue with a quarter of it to spare.
pub const MAX_DOC_KEPT: usize = QUEUE_FRAMES * 3 / 4;
/// Most sticky strokes kept for all of a share's viewers together, here or gone: a host
/// back on a new link is sent them all at once, and they fit in half its queue.
pub const MAX_VIEWERS_KEPT: usize = QUEUE_FRAMES / 2;
/// Messages a viewer may have forwarded to the host in one burst. The page's largest
/// honest burst is Expand all, one `list` per folder of a level; a reconnect re-reads a
/// handful of things, and typing in search sends one message a keystroke.
pub const FORWARD_BURST: f64 = 400.0;
/// Messages a second a viewer may have forwarded to the host, sustained.
pub const FORWARD_PER_SEC: f64 = 40.0;
/// Room in the host's queue that viewers' forwarded messages never take: it is left for
/// what the relay itself must tell the host (who joined and left, presence, fetches).
pub const HOST_RESERVE: usize = QUEUE_FRAMES / 4;

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
    /// The share already runs `MAX_FETCHES` (and, for a fetch that waited, still did
    /// when the wait was over).
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
    /// When its last pointer frame, `inking` frame and finished stroke were let through.
    last_pointer: Option<Instant>,
    last_inking: Option<Instant>,
    last_ink: Option<Instant>,
    /// When everyone was last told where it is on its `at`.
    last_at: Option<Instant>,
    /// It has moved since, and a timer will tell everyone when `AT_MIN_GAP` is over.
    at_pending: bool,
    /// Messages it may have forwarded to the host now, refilled as time passes.
    tokens: f64,
    refilled: Instant,
}

impl Viewer {
    fn new(seq: u64, peer: Peer, tx: Sender<Message>) -> Viewer {
        Viewer {
            seq,
            peer,
            tx,
            last_pointer: None,
            last_inking: None,
            last_ink: None,
            last_at: None,
            at_pending: false,
            tokens: FORWARD_BURST,
            refilled: Instant::now(),
        }
    }

    /// Takes one of the viewer's forwarded messages out of its allowance: `FORWARD_BURST`
    /// at once, `FORWARD_PER_SEC` sustained. False when it has none left.
    fn take_token(&mut self, now: Instant) -> bool {
        let gained = now.duration_since(self.refilled).as_secs_f64() * FORWARD_PER_SEC;
        self.tokens = (self.tokens + gained).min(FORWARD_BURST);
        self.refilled = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

/// Whether `last` was less than `gap` before `now`; when not, `now` becomes `last`.
fn too_soon(last: &mut Option<Instant>, now: Instant, gap: Duration) -> bool {
    if last.is_some_and(|t| now.duration_since(t) < gap) {
        return true;
    }
    *last = Some(now);
    false
}

/// One viewer's frames for the host, kept while it is away.
#[derive(Default)]
struct Buffered {
    /// `joined` and the hello of a viewer who arrived while the host was away. Never
    /// pushed out: without them the host would not know whose the rest are.
    intro: Vec<String>,
    /// The rest, `BUFFER_PER_VIEWER` at most; the oldest goes first.
    frames: VecDeque<String>,
}

/// A name as the relay keeps it: at most `MAX_NAME_CHARS` characters.
fn clip_name(name: &str) -> String {
    name.chars().take(MAX_NAME_CHARS).collect()
}

/// Whether a path, block hash or stroke id is short enough to keep and pass on.
fn fits(s: &str) -> bool {
    s.len() <= MAX_PATH_LEN
}

/// Whether a stroke is within what the relay keeps and passes on: its names within
/// `MAX_PATH_LEN`, its color within `MAX_COLOR_LEN`, a width above zero and at most
/// `MAX_STROKE_WIDTH`, and at most `max_points` points.
fn stroke_ok(s: &Stroke, max_points: usize) -> bool {
    fits(&s.id)
        && fits(&s.doc_path)
        && fits(&s.block_hash)
        && s.color.len() <= MAX_COLOR_LEN
        && s.width > 0.0
        && s.width <= MAX_STROKE_WIDTH
        && s.points.len() <= max_points
}

pub struct Share {
    host: Option<Sender<Message>>,
    /// Which host connection owns this share (the one live now, or the one that dropped).
    host_conn: u64,
    /// The host's queue overflowed; the share goes into grace when the change settles.
    host_full: bool,
    viewers: HashMap<String, Viewer>,
    /// Frames for the host from each viewer still here (and the relay's own, under
    /// `HOST_ID`) while it is away, replayed on resume.
    buffered: HashMap<String, Buffered>,
    info: ShareInfo,
    host_path: Option<String>,
    /// The host's open slide, shown to every viewer; gone with the share.
    slide: Option<Slide>,
    /// The block open on the host's canvas.
    stage: Option<StageRef>,
    /// Everyone's sticky strokes by `(doc_path, block_hash)`, for viewers who arrive later.
    sticky: HashMap<Canvas, VecDeque<Kept>>,
    /// The canvases in `sticky`, oldest first.
    sticky_order: VecDeque<Canvas>,
    /// The `seq` the next kept stroke gets.
    next_kept: u64,
    grace_timer: Option<JoinHandle<()>>,
    /// Raw fetches waiting on the host, by `req`.
    fetches: HashMap<u32, Fetch>,
    next_req: u32,
}

impl Share {
    fn for_host(&mut self, viewer: &str, msg: &RelayToHost) {
        self.queue_for_host(viewer, msg, false);
    }

    /// Sends the host `msg`, or keeps it for its return under `viewer`. An `intro` frame
    /// (`joined`, the hello) is kept apart from the rest, which can never push it out.
    fn queue_for_host(&mut self, viewer: &str, msg: &RelayToHost, intro: bool) {
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
        if intro {
            q.intro.push(frame);
            return;
        }
        if q.frames.len() == BUFFER_PER_VIEWER {
            q.frames.pop_front();
        }
        q.frames.push_back(frame);
    }

    /// Forgets a viewer who is gone, with whatever was kept for the host from it: a host
    /// that is here hears `left`, and one that is away learns who is still here from
    /// `shared` when it returns. False when there was no such viewer.
    fn remove_viewer(&mut self, viewer: &str) -> bool {
        if self.viewers.remove(viewer).is_none() {
            return false;
        }
        self.buffered.remove(viewer);
        let left = RelayToHost::Left {
            viewer: viewer.to_string(),
        };
        if let Some(tx) = self.host.as_ref().filter(|_| !self.host_full)
            && !offer(tx, text(&left))
        {
            self.host_full = true;
        }
        true
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

    /// Sends `msg` to the viewers on document `path` (every viewer when `None`), except
    /// `skip`, dropping it for any whose queue is full.
    fn to_viewers_on(&self, path: Option<&str>, skip: Option<&str>, msg: &ServerMessage) {
        let m = text(msg);
        for (id, v) in &self.viewers {
            let there = path.is_none_or(|p| v.peer.path.as_deref() == Some(p));
            if there && skip != Some(id.as_str()) {
                offer_drop(&v.tx, m.clone());
            }
        }
    }

    /// Keeps a sticky stroke, within the bounds: `MAX_STICKY_STROKES` on a canvas and
    /// `MAX_DOC_KEPT` on a document, everyone's together; `MAX_VIEWER_KEPT` for one viewer
    /// and `MAX_VIEWERS_KEPT` for all viewers, here or gone, across the share; and
    /// `MAX_STICKY_CANVASES` canvases with the host's strokes. Room is made by dropping the
    /// oldest stroke that isn't the host's, and the host's own oldest only for the host: a
    /// viewer's stroke is not kept where the host's fill the canvas or the document.
    fn keep(&mut self, peer: &str, stroke: Stroke) {
        let key = (stroke.doc_path.clone(), stroke.block_hash.clone());
        let host = peer == HOST_ID;
        let on_canvas = |k: &Canvas| *k == key;
        let on_doc = |k: &Canvas| k.0 == key.0;
        if host {
            let hosts = |k: &Canvas| {
                self.sticky
                    .get(k)
                    .is_some_and(|s| s.iter().any(|x| x.peer == HOST_ID))
            };
            if !hosts(&key)
                && self.sticky_order.iter().filter(|k| hosts(k)).count() >= MAX_STICKY_CANVASES
                && let Some(i) = self.sticky_order.iter().position(hosts)
                && let Some(old) = self.sticky_order.remove(i)
            {
                self.sticky.remove(&old);
            }
        } else {
            let full_of_hosts = |scope: &dyn Fn(&Canvas) -> bool, most: usize| {
                self.kept_in(scope, |_| true) >= most && self.kept_in(scope, |p| p != HOST_ID) == 0
            };
            if full_of_hosts(&on_canvas, MAX_STICKY_STROKES) || full_of_hosts(&on_doc, MAX_DOC_KEPT)
            {
                return;
            }
            if self.kept_in(&|_| true, |p| p == peer) >= MAX_VIEWER_KEPT {
                self.drop_oldest(&|_| true, |p| p == peer);
            }
            if self.kept_in(&|_| true, |p| p != HOST_ID) >= MAX_VIEWERS_KEPT {
                self.drop_oldest(&|_| true, |p| p != HOST_ID);
            }
        }
        for (scope, most) in [
            (&on_canvas as &dyn Fn(&Canvas) -> bool, MAX_STICKY_STROKES),
            (&on_doc, MAX_DOC_KEPT),
        ] {
            while self.kept_in(scope, |_| true) >= most {
                if !self.drop_oldest(scope, |p| p != HOST_ID)
                    && !self.drop_oldest(scope, |p| p == HOST_ID)
                {
                    break;
                }
            }
        }
        if !self.sticky.contains_key(&key) {
            self.sticky_order.push_back(key.clone());
        }
        let seq = self.next_kept;
        self.next_kept += 1;
        self.sticky.entry(key).or_default().push_back(Kept {
            peer: peer.to_string(),
            seq,
            stroke,
        });
    }

    /// How many kept strokes on the canvases in `scope` are by a peer `by` picks.
    fn kept_in(&self, scope: &dyn Fn(&Canvas) -> bool, by: impl Fn(&str) -> bool) -> usize {
        self.sticky
            .iter()
            .filter(|(k, _)| scope(k))
            .flat_map(|(_, strokes)| strokes)
            .filter(|k| by(&k.peer))
            .count()
    }

    /// Drops the oldest kept stroke on the canvases in `scope` by a peer `by` picks. False
    /// when there is none.
    fn drop_oldest(&mut self, scope: &dyn Fn(&Canvas) -> bool, by: impl Fn(&str) -> bool) -> bool {
        let oldest = self
            .sticky
            .iter()
            .filter(|(k, _)| scope(k))
            .flat_map(|(key, strokes)| strokes.iter().map(move |k| (key, k)))
            .filter(|(_, k)| by(&k.peer))
            .min_by_key(|(_, k)| k.seq)
            .map(|(key, k)| (key.clone(), k.seq));
        let Some((key, seq)) = oldest else {
            return false;
        };
        if let Some(strokes) = self.sticky.get_mut(&key) {
            strokes.retain(|k| k.seq != seq);
        }
        self.prune(&key);
        true
    }

    /// Forgets a canvas that has no kept strokes left.
    fn prune(&mut self, key: &Canvas) {
        if self.sticky.get(key).is_some_and(|s| s.is_empty()) {
            self.sticky.remove(key);
            self.sticky_order.retain(|k| k != key);
        }
    }

    /// Sends the host, on a link it just opened, the viewers' kept strokes, so what it
    /// shows matches what viewers see; its own it still has. There are `MAX_VIEWERS_KEPT`
    /// at most, which a new link's queue has room for.
    fn send_kept_to_host(&self) {
        let Some(tx) = &self.host else {
            return;
        };
        for key in &self.sticky_order {
            for kept in self.sticky.get(key).into_iter().flatten() {
                if kept.peer != HOST_ID {
                    let m = RelayToHost::Ink {
                        viewer: kept.peer.clone(),
                        stroke: kept.stroke.clone(),
                    };
                    offer_drop(tx, text(&m));
                }
            }
        }
    }

    /// Sends the host a frame it can do without: only when it is here and keeping up, with
    /// half its queue free, so a burst never fills the queue and marks the host behind.
    fn to_host_if_room(&self, msg: &RelayToHost) {
        if let Some(tx) = self
            .host
            .as_ref()
            .filter(|tx| !self.host_full && tx.capacity() >= QUEUE_FRAMES / 2)
        {
            offer_drop(tx, text(msg));
        }
    }

    /// A peer's finished stroke: to the viewers on its document (never back to the peer),
    /// and kept when sticky.
    fn ink_from(&mut self, peer: &str, stroke: Stroke) {
        let doc_path = stroke.doc_path.clone();
        self.to_viewers_on(
            Some(&doc_path),
            Some(peer),
            &ServerMessage::Ink {
                peer: peer.to_string(),
                stroke: stroke.clone(),
                in_reply_to: None,
            },
        );
        if stroke.sticky {
            self.keep(peer, stroke);
        }
    }

    /// A peer's stroke in progress: to the viewers on its document, and forgotten.
    fn inking_from(&self, peer: &str, stroke: Stroke) {
        let doc_path = stroke.doc_path.clone();
        self.to_viewers_on(
            Some(&doc_path),
            Some(peer),
            &ServerMessage::Inking {
                peer: peer.to_string(),
                stroke,
                in_reply_to: None,
            },
        );
    }

    /// A peer's undo: the kept stroke it names, or its last on the canvas, goes; the viewers
    /// on the document are told.
    fn ink_undo_from(
        &mut self,
        peer: &str,
        doc_path: String,
        block_hash: String,
        stroke_id: Option<String>,
    ) {
        let key = (doc_path.clone(), block_hash.clone());
        if let Some(strokes) = self.sticky.get_mut(&key) {
            let i = match &stroke_id {
                Some(id) => strokes
                    .iter()
                    .position(|k| k.peer == peer && k.stroke.id == *id),
                None => strokes.iter().rposition(|k| k.peer == peer),
            };
            if let Some(i) = i {
                strokes.remove(i);
            }
        }
        self.prune(&key);
        let m = ServerMessage::InkUndo {
            peer: peer.to_string(),
            doc_path: doc_path.clone(),
            block_hash,
            stroke_id,
            in_reply_to: None,
        };
        self.to_viewers_on(Some(&doc_path), Some(peer), &m);
    }

    /// A peer's clear: its kept strokes on the canvas go, or everyone's when the host
    /// clears (a viewer's id changes on reconnect, so only the host can always wipe a
    /// canvas); the viewers on the document are told.
    fn ink_clear_from(&mut self, peer: &str, doc_path: String, block_hash: String) {
        let key = (doc_path.clone(), block_hash.clone());
        if let Some(strokes) = self.sticky.get_mut(&key) {
            if peer != HOST_ID {
                strokes.retain(|k| k.peer != peer);
            } else {
                strokes.clear();
            }
        }
        self.prune(&key);
        let m = ServerMessage::InkClear {
            peer: peer.to_string(),
            doc_path: doc_path.clone(),
            block_hash,
            in_reply_to: None,
        };
        self.to_viewers_on(Some(&doc_path), Some(peer), &m);
    }

    /// Sends one viewer the kept strokes of every canvas on document `path`: `MAX_DOC_KEPT`
    /// at most, which its queue has room for unless it is far behind. False when one did
    /// not fit: the viewer is to be dropped, since it would otherwise show a canvas with
    /// strokes missing and never know.
    fn send_kept(&self, viewer: &str, path: &str) -> bool {
        let Some(v) = self.viewers.get(viewer) else {
            return true;
        };
        for key in self.sticky_order.iter().filter(|(doc, _)| doc == path) {
            for kept in self.sticky.get(key).into_iter().flatten() {
                let m = ServerMessage::Ink {
                    peer: kept.peer.clone(),
                    stroke: kept.stroke.clone(),
                    in_reply_to: None,
                };
                if !offer(&v.tx, text(&m)) {
                    return false;
                }
            }
        }
        true
    }

    fn peers(&self) -> Vec<Peer> {
        let mut v: Vec<&Viewer> = self.viewers.values().collect();
        v.sort_by_key(|v| v.seq);
        v.into_iter().map(|v| v.peer.clone()).collect()
    }

    /// What the host is told about the viewers: who they are and where they are.
    fn presence_for_host(&self) -> RelayToHost {
        RelayToHost::Presence {
            viewers: self.peers(),
        }
    }

    /// Sends everyone, the host included, presence; returns the viewers whose queues were full.
    fn presence(&mut self) -> Vec<String> {
        let viewers = self.peers();
        let mut full = Vec::new();
        for (id, v) in &self.viewers {
            let m = text(&ServerMessage::Presence {
                host: self.info.host.clone(),
                host_path: self.host_path.clone(),
                viewers: viewers.clone(),
                you: id.clone(),
                slide: self.slide.clone(),
                stage: self.stage.clone(),
                in_reply_to: None,
            });
            if !offer(&v.tx, m) {
                full.push(id.clone());
            }
        }
        let for_host = self.presence_for_host();
        self.for_host(HOST_ID, &for_host);
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

/// A path a viewer names, kept only when it stays inside the share: relative, with no
/// `.`, `..`, empty or backslash parts, and at most `MAX_PATH_LEN` bytes. Returns it
/// joined cleanly.
pub fn clean_share_path(p: &str) -> Option<String> {
    if p.len() > MAX_PATH_LEN || p.contains('\\') {
        return None;
    }
    let mut parts = Vec::new();
    for (i, part) in p.split('/').enumerate() {
        match part {
            ".." => return None,
            "" if i == 0 => return None,
            "" | "." => {}
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
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
    /// Told whenever a raw fetch ends, on any share: the fetches waiting for a slot look again.
    fetch_freed: Notify,
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
            fetch_freed: Notify::new(),
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
                if share.remove_viewer(&vid) {
                    tracing::warn!(share = %id, viewer = %vid, "viewer fell behind; dropped");
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
        self.fetch_freed.notify_waiters();
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
        let name = clip_name(name);
        let host = Peer {
            id: HOST_ID.into(),
            color: color_for(&name),
            name,
            path: None,
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
                self.fetch_freed.notify_waiters();
                // What the host had open when its link went may be closed by now, and it
                // says again only what it has: start from nothing, as a new share does.
                let stale = share.host_path.take().is_some()
                    | share.slide.take().is_some()
                    | share.stage.take().is_some();
                let mut queued: Vec<(String, Buffered)> = share.buffered.drain().collect();
                queued.sort_by_key(|(v, _)| viewer_seq(v));
                replay = queued
                    .into_iter()
                    .flat_map(|(_, q)| q.intro.into_iter().chain(q.frames))
                    .collect();
                share.host = Some(tx);
                share.send_kept_to_host();
                viewers = share.peers();
                if replacing.is_none() {
                    let mut full = share.status(ShareState::Live, None);
                    full.extend(share.presence());
                    tracing::info!(share = %id, viewers = share.viewers.len(), "host resumed");
                    self.settle(&id, share, full);
                } else if stale {
                    let full = share.presence();
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
                        slide: None,
                        stage: None,
                        sticky: HashMap::new(),
                        sticky_order: VecDeque::new(),
                        next_kept: 0,
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
            capabilities: vec!["presence".into()],
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
            share.remove_viewer(viewer);
            tracing::info!(share = %id, viewer, "viewer expelled by the host");
            let full = share.presence();
            self.settle(id, share, full);
        } else if !delivered {
            self.settle(id, share, vec![viewer.to_string()]);
        }
    }

    /// The host's `path`: what it is reading now. Like everything the host names below, a
    /// path or hash over `MAX_PATH_LEN` bytes is ignored, message and all.
    pub fn path(self: &Arc<Self>, id: &str, conn: u64, path: Option<String>) {
        if path.as_ref().is_some_and(|p| !fits(p)) {
            return too_long(id, "path");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.host_path = path;
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// The host's `slide`: the slide it has open, or none.
    pub fn slide(self: &Arc<Self>, id: &str, conn: u64, slide: Option<Slide>) {
        if slide.as_ref().is_some_and(|s| !fits(&s.path)) {
            return too_long(id, "slide");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.slide = slide;
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// The host's `stage`: the block open on its canvas, or none.
    pub fn stage(self: &Arc<Self>, id: &str, conn: u64, stage: Option<StageRef>) {
        if stage
            .as_ref()
            .is_some_and(|s| !fits(&s.doc_path) || !fits(&s.block_hash))
        {
            return too_long(id, "stage");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.stage = stage;
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// The host's `pointer`: shown to the viewers on its document, or to all when it is gone.
    pub fn pointer(self: &Arc<Self>, id: &str, conn: u64, pointer: Option<PointerAt>) {
        if pointer
            .as_ref()
            .is_some_and(|p| !fits(&p.doc_path) || !fits(&p.block_hash))
        {
            return too_long(id, "pointer");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            let doc = pointer.as_ref().map(|p| p.doc_path.clone());
            share.to_viewers_on(
                doc.as_deref(),
                None,
                &ServerMessage::Pointer {
                    peer: HOST_ID.to_string(),
                    pointer,
                    in_reply_to: None,
                },
            );
        }
    }

    /// The host's `ink`: a stroke for the viewers on its document; kept when sticky. One
    /// out of bounds (`stroke_ok`, with `MAX_HOST_STROKE_POINTS`) is dropped.
    pub fn ink(self: &Arc<Self>, id: &str, conn: u64, stroke: Stroke) {
        if !stroke_ok(&stroke, MAX_HOST_STROKE_POINTS) {
            return too_long(id, "ink");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.ink_from(HOST_ID, stroke);
        }
    }

    /// The host's `inking`: a stroke in progress, for the viewers on its document.
    pub fn inking(self: &Arc<Self>, id: &str, conn: u64, stroke: Stroke) {
        if !stroke_ok(&stroke, MAX_HOST_STROKE_POINTS) {
            return too_long(id, "inking");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.inking_from(HOST_ID, stroke);
        }
    }

    /// The host's `inkUndo`: the kept stroke it names, or its last on the canvas, goes;
    /// viewers on it are told.
    pub fn ink_undo(
        self: &Arc<Self>,
        id: &str,
        conn: u64,
        doc_path: String,
        block_hash: String,
        stroke_id: Option<String>,
    ) {
        if !fits(&doc_path) || !fits(&block_hash) || stroke_id.as_ref().is_some_and(|i| !fits(i)) {
            return too_long(id, "inkUndo");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.ink_undo_from(HOST_ID, doc_path, block_hash, stroke_id);
        }
    }

    /// The host's `inkClear`: every kept stroke on the canvas goes; viewers on it are told.
    pub fn ink_clear(self: &Arc<Self>, id: &str, conn: u64, doc_path: String, block_hash: String) {
        if !fits(&doc_path) || !fits(&block_hash) {
            return too_long(id, "inkClear");
        }
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.ink_clear_from(HOST_ID, doc_path, block_hash);
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
            self.fetch_freed.notify_waiters();
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
            self.fetch_freed.notify_waiters();
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
        let name = name.map_or_else(auto_name, |n| clip_name(&n));
        let peer = Peer {
            id: vid.clone(),
            color: color_for(&name),
            name,
            path: None,
        };
        share.queue_for_host(
            &vid,
            &RelayToHost::Joined {
                viewer: vid.clone(),
                name: peer.name.clone(),
                color: peer.color.clone(),
            },
            true,
        );
        share.queue_for_host(
            &vid,
            &RelayToHost::FromViewer {
                viewer: vid.clone(),
                msg: hello,
            },
            true,
        );
        // A fresh queue: these can't overflow.
        if share.host.is_none() {
            let _ = offer(&tx, status(ShareState::Reconnecting, None));
        }
        share
            .viewers
            .insert(vid.clone(), Viewer::new(seq, peer, tx));
        tracing::info!(share = %id, viewer = %vid, viewers = share.viewers.len(), "viewer joined");
        let full = share.presence();
        self.settle(id, share, full);
        Ok(vid)
    }

    /// A viewer's message, for the host (or its buffer while the host is away). Where it
    /// is, its pointer and its ink the relay handles itself; the rest is forwarded, within
    /// the viewer's allowance and never into the host's last `HOST_RESERVE` places. A
    /// viewer over either is closed (its page connects again): whatever it sends, the
    /// host's queue cannot overflow on its account.
    pub fn from_viewer(self: &Arc<Self>, id: &str, viewer: &str, msg: Value) {
        let mut shares = self.lock();
        let Some(share) = shares.get_mut(id) else {
            return;
        };
        if !share.viewers.contains_key(viewer) {
            return;
        }
        match msg.get("type").and_then(Value::as_str) {
            Some("at") => return self.viewer_at(id, share, viewer, &msg),
            Some("pointer") => return Self::viewer_pointer(share, viewer, &msg),
            Some(kind @ ("ink" | "inking" | "inkUndo" | "inkClear")) => {
                return Self::viewer_ink(share, viewer, kind, &msg);
            }
            _ => {}
        }
        let now = Instant::now();
        let within = share
            .viewers
            .get_mut(viewer)
            .is_some_and(|v| v.take_token(now));
        let room = share
            .host
            .as_ref()
            .is_none_or(|tx| tx.capacity() > HOST_RESERVE);
        if within && room {
            share.for_host(
                viewer,
                &RelayToHost::FromViewer {
                    viewer: viewer.to_string(),
                    msg,
                },
            );
            return self.settle(id, share, Vec::new());
        }
        // 1008: the viewer broke a rule. 1013: try again later.
        let (code, reason) = if within {
            (1013, "the host is busy")
        } else {
            (1008, "too many messages")
        };
        tracing::warn!(share = %id, viewer, reason, "viewer closed");
        if let Some(v) = share.viewers.get(viewer) {
            let _ = offer(
                &v.tx,
                Message::Close(Some(CloseFrame {
                    code,
                    reason: reason.into(),
                })),
            );
        }
        share.remove_viewer(viewer);
        let full = share.presence();
        self.settle(id, share, full);
    }

    /// A viewer's `at`: where it is reading, never forwarded to the host as a message.
    /// Nothing happens for a path outside the share or too long, or the one it is already
    /// on. Otherwise the path is stored at once, so its pointer and ink there count from
    /// now, and it is sent the document's kept strokes. Everyone is told at once too,
    /// unless they were told of this viewer within `AT_MIN_GAP`: then a timer tells them
    /// when the gap is over, wherever the viewer is by then.
    fn viewer_at(self: &Arc<Self>, id: &str, share: &mut Share, viewer: &str, msg: &Value) {
        let Some(at) = msg
            .get("path")
            .and_then(Value::as_str)
            .and_then(clean_share_path)
        else {
            return;
        };
        let Some(v) = share.viewers.get_mut(viewer) else {
            return;
        };
        if v.peer.path.as_deref() == Some(at.as_str()) {
            return;
        }
        v.peer.path = Some(at.clone());
        let now = Instant::now();
        let mut full = Vec::new();
        match v.last_at.filter(|t| now.duration_since(*t) < AT_MIN_GAP) {
            None => {
                v.last_at = Some(now);
                full = share.presence();
            }
            Some(_) if v.at_pending => {}
            Some(last) => {
                v.at_pending = true;
                let relay = Arc::clone(self);
                let (id, viewer) = (id.to_string(), viewer.to_string());
                tokio::spawn(async move {
                    tokio::time::sleep_until((last + AT_MIN_GAP).into()).await;
                    relay.announce_at(&id, &viewer);
                });
            }
        }
        if !share.send_kept(viewer, &at) {
            full.push(viewer.to_string());
        }
        self.settle(id, share, full);
    }

    /// `AT_MIN_GAP` after a viewer's last announced `at`: everyone is told where it is now.
    fn announce_at(self: &Arc<Self>, id: &str, viewer: &str) {
        let mut shares = self.lock();
        let Some(share) = shares.get_mut(id) else {
            return;
        };
        let Some(v) = share.viewers.get_mut(viewer).filter(|v| v.at_pending) else {
            return;
        };
        v.at_pending = false;
        v.last_at = Some(Instant::now());
        let full = share.presence();
        self.settle(id, share, full);
    }

    /// A viewer's ink: a finished stroke, one in progress, an undo or a clear, accepted
    /// only on the document the viewer said it is on, with paths, hashes and ids of at most
    /// `MAX_PATH_LEN` bytes, a stroke within bounds (`stroke_ok`) with at most
    /// `MAX_INKING_POINTS` points in a frame in progress and `MAX_STROKE_POINTS` in a
    /// finished one, and no closer together than `INKING_MIN_GAP` and `INK_MIN_GAP`. Shown to the other viewers on the document, and to the host only
    /// while it is here with room to spare: ink never buffers for an away host and never
    /// marks it behind (a host that comes back gets the kept strokes instead).
    fn viewer_ink(share: &mut Share, viewer: &str, kind: &str, msg: &Value) {
        let Some(v) = share.viewers.get_mut(viewer) else {
            return;
        };
        let here = v.peer.path.clone();
        let on_canvas =
            |doc: &str, hash: &str| fits(doc) && fits(hash) && here.as_deref() == Some(doc);
        let now = Instant::now();
        match kind {
            "ink" | "inking" => {
                let Some(stroke) = msg
                    .get("stroke")
                    .and_then(|s| serde_json::from_value::<Stroke>(s.clone()).ok())
                else {
                    return;
                };
                if !on_canvas(&stroke.doc_path, &stroke.block_hash) {
                    return;
                }
                if kind == "inking" {
                    if !stroke_ok(&stroke, MAX_INKING_POINTS)
                        || too_soon(&mut v.last_inking, now, INKING_MIN_GAP)
                    {
                        return;
                    }
                    share.inking_from(viewer, stroke.clone());
                    share.to_host_if_room(&RelayToHost::Inking {
                        viewer: viewer.to_string(),
                        stroke,
                    });
                    return;
                }
                if !stroke_ok(&stroke, MAX_STROKE_POINTS)
                    || too_soon(&mut v.last_ink, now, INK_MIN_GAP)
                {
                    return;
                }
                share.ink_from(viewer, stroke.clone());
                share.to_host_if_room(&RelayToHost::Ink {
                    viewer: viewer.to_string(),
                    stroke,
                });
            }
            _ => {
                let (Some(doc_path), Some(block_hash)) = (
                    msg.get("docPath").and_then(Value::as_str),
                    msg.get("blockHash").and_then(Value::as_str),
                ) else {
                    return;
                };
                let stroke_id = msg
                    .get("strokeId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if !on_canvas(doc_path, block_hash) || stroke_id.as_ref().is_some_and(|i| !fits(i))
                {
                    return;
                }
                let (doc_path, block_hash) = (doc_path.to_string(), block_hash.to_string());
                let to_host = if kind == "inkUndo" {
                    share.ink_undo_from(
                        viewer,
                        doc_path.clone(),
                        block_hash.clone(),
                        stroke_id.clone(),
                    );
                    RelayToHost::InkUndo {
                        viewer: viewer.to_string(),
                        doc_path,
                        block_hash,
                        stroke_id,
                    }
                } else {
                    share.ink_clear_from(viewer, doc_path.clone(), block_hash.clone());
                    RelayToHost::InkClear {
                        viewer: viewer.to_string(),
                        doc_path,
                        block_hash,
                    }
                };
                share.to_host_if_room(&to_host);
            }
        }
    }

    /// A viewer's `pointer`: accepted only on the document the viewer said it is on and
    /// with a path and hash of at most `MAX_PATH_LEN` bytes, thinned to one frame per
    /// `POINTER_MIN_GAP`, then shown to the other viewers on its document and to the host
    /// if it is present with room to spare. Never sent back to its sender.
    fn viewer_pointer(share: &mut Share, viewer: &str, msg: &Value) {
        let pointer = match msg.get("pointer") {
            None | Some(Value::Null) => None,
            Some(p) => match serde_json::from_value::<PointerAt>(p.clone()) {
                Ok(p) => Some(p),
                Err(_) => return,
            },
        };
        let Some(v) = share.viewers.get_mut(viewer) else {
            return;
        };
        // Only a pointer that is somewhere is checked and thinned: a gone one always goes
        // through, or it would linger on the others' screens.
        if let Some(p) = &pointer
            && (!fits(&p.doc_path)
                || !fits(&p.block_hash)
                || v.peer.path.as_deref() != Some(p.doc_path.as_str())
                || too_soon(&mut v.last_pointer, Instant::now(), POINTER_MIN_GAP))
        {
            return;
        }
        let doc = pointer.as_ref().map(|p| p.doc_path.clone());
        share.to_viewers_on(
            doc.as_deref(),
            Some(viewer),
            &ServerMessage::Pointer {
                peer: viewer.to_string(),
                pointer: pointer.clone(),
                in_reply_to: None,
            },
        );
        share.to_host_if_room(&RelayToHost::Pointer {
            viewer: viewer.to_string(),
            pointer,
        });
    }

    /// A viewer's socket closed. Nothing to do when it was already dropped or the share ended.
    pub fn viewer_left(self: &Arc<Self>, id: &str, viewer: &str) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share.remove_viewer(viewer)
        {
            tracing::info!(share = %id, viewer, viewers = share.viewers.len(), "viewer left");
            let full = share.presence();
            self.settle(id, share, full);
        }
    }

    /// A viewer's `GET /s/{id}/raw/{path}`: asks the host for the bytes, waiting up to
    /// `wait` for one of the share's `MAX_FETCHES` slots. A page with many pictures asks
    /// for more than that at once, and an `<img>` refused is never asked for again.
    pub async fn start_fetch_when_free(
        self: &Arc<Self>,
        id: &str,
        path: String,
        range: Option<String>,
        wait: Duration,
    ) -> Result<Started, FetchRefused> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            // Listening before the look, so a slot freed between the two is not missed.
            let freed = self.fetch_freed.notified();
            tokio::pin!(freed);
            freed.as_mut().enable();
            match self.start_fetch(id, path.clone(), range.clone()) {
                Err(FetchRefused::Busy) => {}
                other => return other,
            }
            if tokio::time::timeout_at(deadline, freed).await.is_err() {
                tracing::warn!(share = %id, %path, "raw fetch gave up waiting for a slot");
                return Err(FetchRefused::Busy);
            }
        }
    }

    /// Asks the host for a file's bytes now, or refuses: `Busy` when the share already
    /// runs `MAX_FETCHES`.
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
            tracing::debug!(share = %id, "raw fetch has no slot yet");
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
            self.fetch_freed.notify_waiters();
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
                self.fetch_freed.notify_waiters();
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
            self.fetch_freed.notify_waiters();
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

/// Notes a host message dropped for a path, hash, id or stroke out of bounds.
fn too_long(id: &str, kind: &str) {
    tracing::debug!(share = %id, kind, "host message out of bounds; ignored");
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
    use serde_json::json;
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

    fn payload(m: &Message) -> Value {
        match m {
            Message::Text(t) => serde_json::from_str(t).unwrap(),
            other => panic!("not a text frame: {other:?}"),
        }
    }

    /// A share by "Rob" with Ann and Bob joined and every queue drained.
    async fn crowd() -> (
        Arc<Relay>,
        String,
        (String, mpsc::Receiver<Message>),
        (String, mpsc::Receiver<Message>),
        mpsc::Receiver<Message>,
    ) {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let join = |name: &str| {
            let (tx, rx) = mpsc::channel(QUEUE_FRAMES);
            let vid = r
                .join(&id, Some(name.into()), json!({"type": "hello"}), tx)
                .unwrap();
            (vid, rx)
        };
        let (ann, mut arx) = join("Ann");
        let (bob, mut brx) = join("Bob");
        while arx.try_recv().is_ok() {}
        while brx.try_recv().is_ok() {}
        while hrx.try_recv().is_ok() {}
        (r, id, (ann, arx), (bob, brx), hrx)
    }

    #[tokio::test]
    async fn a_viewer_says_where_it_is_and_everyone_hears_including_the_host() {
        let (r, id, (ann, mut arx), (_bob, mut brx), mut hrx) = crowd().await;
        r.from_viewer(&id, &ann, json!({"type": "at", "path": "docs/a.md"}));
        for rx in [&mut arx, &mut brx] {
            let p = payload(&rx.try_recv().unwrap());
            assert_eq!(p["type"], "presence");
            assert_eq!(p["viewers"][0]["path"], "docs/a.md");
            assert!(p["viewers"][1]["path"].is_null());
        }
        let p = payload(&hrx.try_recv().unwrap());
        assert_eq!(p["type"], "presence");
        assert_eq!(p["viewers"][0]["path"], "docs/a.md");
        assert_eq!(p["viewers"].as_array().unwrap().len(), 2);
        assert!(hrx.try_recv().is_err(), "an `at` is not forwarded");
        r.shutdown();
    }

    #[tokio::test]
    async fn an_at_outside_the_share_is_ignored() {
        let (r, id, (ann, mut arx), (_bob, mut brx), mut hrx) = crowd().await;
        for bad in ["../x", "/etc/passwd", "a/../../b", "a\\b"] {
            r.from_viewer(&id, &ann, json!({"type": "at", "path": bad}));
        }
        assert!(brx.try_recv().is_err());
        assert!(arx.try_recv().is_err());
        assert!(hrx.try_recv().is_err());
        r.from_viewer(&id, &ann, json!({"type": "at"}));
        assert!(brx.try_recv().is_err(), "a missing path is ignored too");
        r.slide(&id, 1, None);
        let p = payload(&brx.try_recv().unwrap());
        assert!(p["viewers"][0]["path"].is_null());
        r.shutdown();
    }

    #[tokio::test]
    async fn the_hosts_slide_and_canvas_ride_in_presence_and_reach_a_late_viewer() {
        let (r, id, (_ann, mut arx), _bob, _hrx) = crowd().await;
        r.slide(
            &id,
            1,
            Some(Slide {
                path: "deck.md".into(),
                index: 4,
            }),
        );
        r.stage(
            &id,
            1,
            Some(StageRef {
                doc_path: "a.mmd".into(),
                block_hash: "h".into(),
            }),
        );
        assert_eq!(payload(&arx.try_recv().unwrap())["slide"]["index"], 4);
        assert_eq!(payload(&arx.try_recv().unwrap())["stage"]["blockHash"], "h");
        let (tx, mut late) = mpsc::channel(QUEUE_FRAMES);
        r.join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
            .unwrap();
        let p = payload(&late.try_recv().unwrap());
        assert_eq!(p["slide"]["index"], 4);
        assert_eq!(p["stage"]["blockHash"], "h");
        r.slide(&id, 1, None);
        while arx.try_recv().is_ok() {}
        let p = payload(&late.try_recv().unwrap());
        assert!(p["slide"].is_null());
        assert_eq!(p["stage"]["blockHash"], "h");
        r.shutdown();
    }

    fn at(doc: &str, hash: &str) -> PointerAt {
        PointerAt {
            doc_path: doc.into(),
            block_hash: hash.into(),
            x: 1.0,
            y: 2.0,
        }
    }

    fn stroke(id: &str, doc: &str, hash: &str, sticky: bool) -> Stroke {
        Stroke {
            id: id.into(),
            doc_path: doc.into(),
            block_hash: hash.into(),
            points: vec![[0.0, 0.0], [1.0, 1.0]],
            color: "red".into(),
            width: 2.0,
            sticky,
            created_at: 0.0,
        }
    }

    /// `crowd()` with Ann at `a.mmd` and Bob at `b.md`, every queue drained again.
    async fn placed() -> (
        Arc<Relay>,
        String,
        (String, mpsc::Receiver<Message>),
        (String, mpsc::Receiver<Message>),
        mpsc::Receiver<Message>,
    ) {
        let (r, id, (ann, mut arx), (bob, mut brx), mut hrx) = crowd().await;
        r.from_viewer(&id, &ann, json!({"type": "at", "path": "a.mmd"}));
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "b.md"}));
        while arx.try_recv().is_ok() {}
        while brx.try_recv().is_ok() {}
        while hrx.try_recv().is_ok() {}
        forget_at(&r, &id);
        (r, id, (ann, arx), (bob, brx), hrx)
    }

    /// Forgets when each viewer was last announced, so its next `at` is told at once.
    fn forget_at(r: &Relay, id: &str) {
        for v in r.lock().get_mut(id).unwrap().viewers.values_mut() {
            v.last_at = None;
        }
    }

    /// Lets the next finished stroke and `inking` frame from every viewer through at once.
    fn forget_ink(r: &Relay, id: &str) {
        for v in r.lock().get_mut(id).unwrap().viewers.values_mut() {
            v.last_ink = None;
            v.last_inking = None;
        }
    }

    #[tokio::test]
    async fn the_hosts_pointer_reaches_only_viewers_on_that_document() {
        let (r, id, (_ann, mut arx), (_bob, mut brx), _hrx) = placed().await;
        r.pointer(&id, 1, Some(at("a.mmd", "h")));
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(p["type"], "pointer");
        assert_eq!(p["peer"], "host");
        assert_eq!(p["pointer"]["docPath"], "a.mmd");
        assert!(brx.try_recv().is_err());
        r.pointer(&id, 1, None);
        for rx in [&mut arx, &mut brx] {
            let p = payload(&rx.try_recv().unwrap());
            assert_eq!(p["type"], "pointer");
            assert!(p["pointer"].is_null());
        }
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_pointer_reaches_the_others_on_the_document_and_the_host() {
        let (r, id, (ann, mut arx), (_bob, mut brx), mut hrx) = placed().await;
        let (tx, mut crx) = mpsc::channel(QUEUE_FRAMES);
        r.join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
            .unwrap();
        let cy = "v3";
        r.from_viewer(&id, cy, json!({"type": "at", "path": "a.mmd"}));
        while arx.try_recv().is_ok() {}
        while brx.try_recv().is_ok() {}
        while crx.try_recv().is_ok() {}
        while hrx.try_recv().is_ok() {}
        r.from_viewer(
            &id,
            &ann,
            json!({"type": "pointer", "pointer": {"docPath": "a.mmd", "blockHash": "h", "x": 1.0, "y": 2.0}}),
        );
        let p = payload(&crx.try_recv().unwrap());
        assert_eq!(p["type"], "pointer");
        assert_eq!(p["peer"], ann);
        assert!(brx.try_recv().is_err());
        assert!(arx.try_recv().is_err(), "the sender never hears itself");
        let p = payload(&hrx.try_recv().unwrap());
        assert_eq!(p["type"], "pointer");
        assert_eq!(p["viewer"], ann);
        assert_eq!(p["pointer"]["blockHash"], "h");
        assert!(hrx.try_recv().is_err(), "not forwarded as a viewer message");
        r.shutdown();
    }

    #[tokio::test]
    async fn pointer_frames_are_dropped_not_queued_when_a_viewer_is_full() {
        let (r, id, _ann, _bob, _hrx) = placed().await;
        let (tx, mut full) = mpsc::channel(1);
        let cy = r
            .join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
            .unwrap();
        // Cy's single slot holds presence; a pointer finds no room.
        r.pointer(&id, 1, None);
        assert_eq!(full.try_recv().map(|m| kind(&m)).unwrap(), "presence");
        assert!(
            full.try_recv().is_err(),
            "the pointer was dropped, not queued"
        );
        r.pointer(&id, 1, None);
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(share.viewers.contains_key(&cy), "still a viewer");
        assert!(!share.host_full);
        drop(shares);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_pointer_is_never_buffered_for_an_away_host_nor_marks_a_full_one_behind() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(1);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let (vtx, _vrx) = mpsc::channel(QUEUE_FRAMES);
        let ann = r
            .join(&id, Some("Ann".into()), json!({"type": "hello"}), vtx)
            .unwrap();
        // The host's one slot holds `joined`; the hello overflowed it, so it is away.
        assert_eq!(kind(&hrx.try_recv().unwrap()), "joined");
        r.from_viewer(&id, &ann, json!({"type": "at", "path": "a.mmd"}));
        let frame = json!({"type": "pointer", "pointer": {"docPath": "a.mmd", "blockHash": "h", "x": 1.0, "y": 2.0}});
        let held = |r: &Relay| {
            let shares = r.lock();
            let q = &shares.get(&id).unwrap().buffered[&ann];
            q.intro.len() + q.frames.len()
        };
        let before = held(&r);
        for _ in 0..3 {
            r.from_viewer(&id, &ann, frame.clone());
            std::thread::sleep(POINTER_MIN_GAP);
        }
        assert_eq!(held(&r), before);
        let (htx, _hrx) = mpsc::channel(QUEUE_FRAMES);
        let resume = Resume {
            id: id.clone(),
            host_key: hostkey::host_key(b"s", &id),
        };
        let a = r
            .share(2, htx, "Rob", ShareMode::ReadOnly, Some(resume))
            .ok()
            .unwrap();
        assert!(
            a.replay.iter().all(|f| !f.contains("\"pointer\"")),
            "{:?}",
            a.replay
        );
        r.shutdown();

        // A present host whose queue is full is not marked behind by a pointer.
        let r = relay();
        let (htx, _hrx) = mpsc::channel(1);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let (vtx, _vrx) = mpsc::channel(QUEUE_FRAMES);
        let tx_only = r.lock().get(&id).unwrap().host.clone().unwrap();
        tx_only.try_send(Message::Text("x".into())).unwrap();
        let ann = {
            // Join through the share directly so the host's overflow doesn't happen yet.
            let mut shares = r.lock();
            let share = shares.get_mut(&id).unwrap();
            share.viewers.insert(
                "v9".into(),
                Viewer::new(
                    9,
                    Peer {
                        id: "v9".into(),
                        name: "Ann".into(),
                        color: color_for("Ann"),
                        path: Some("a.mmd".into()),
                    },
                    vtx,
                ),
            );
            "v9"
        };
        r.from_viewer(&id, ann, frame);
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(!share.host_full);
        assert!(share.buffered.is_empty());
        drop(shares);
        r.shutdown();
    }

    #[tokio::test]
    async fn pointers_faster_than_twenty_a_second_are_thinned() {
        let (r, id, (ann, _arx), _bob, mut hrx) = placed().await;
        let frame = json!({"type": "pointer", "pointer": {"docPath": "a.mmd", "blockHash": "h", "x": 1.0, "y": 2.0}});
        for _ in 0..10 {
            r.from_viewer(&id, &ann, frame.clone());
        }
        assert_eq!(payload(&hrx.try_recv().unwrap())["type"], "pointer");
        assert!(hrx.try_recv().is_err());
        tokio::time::sleep(Duration::from_millis(60)).await;
        r.from_viewer(&id, &ann, frame);
        assert_eq!(payload(&hrx.try_recv().unwrap())["type"], "pointer");
        assert!(hrx.try_recv().is_err());
        r.shutdown();
    }

    fn pointer_frame(doc: &str, hash: &str) -> Value {
        json!({"type": "pointer", "pointer": {"docPath": doc, "blockHash": hash, "x": 1.0, "y": 2.0}})
    }

    fn path_of(r: &Relay, id: &str, viewer: &str) -> Option<String> {
        r.lock().get(id).unwrap().viewers[viewer].peer.path.clone()
    }

    #[tokio::test]
    async fn an_at_for_the_path_a_viewer_is_on_says_nothing() {
        let (r, id, (ann, mut arx), (_bob, mut brx), mut hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        while arx.try_recv().is_ok() {}
        r.from_viewer(&id, &ann, json!({"type": "at", "path": "./a.mmd"}));
        assert!(
            arx.try_recv().is_err(),
            "no presence, no kept strokes again"
        );
        assert!(brx.try_recv().is_err());
        assert!(hrx.try_recv().is_err());
        r.shutdown();
    }

    #[tokio::test]
    async fn an_at_is_stored_at_once_and_only_its_announcement_is_thinned() {
        let (r, id, _ann, (bob, mut brx), mut hrx) = placed().await;
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "c.md"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        r.ink(&id, 1, stroke("s1", "d.md", "h", true));
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "e.md"}));
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "d.md"}));
        // Too soon to announce, but the relay knows where Bob is: he gets the document's
        // kept strokes, and his pointer there counts.
        assert_eq!(path_of(&r, &id, &bob).as_deref(), Some("d.md"));
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["stroke"]["id"].as_str()),
            (Some("ink"), Some("s1"))
        );
        assert!(brx.try_recv().is_err(), "no presence yet");
        while hrx.try_recv().is_ok() {}
        r.from_viewer(&id, &bob, pointer_frame("d.md", "h"));
        assert_eq!(kind(&hrx.try_recv().unwrap()), "pointer");
        // The last position is always announced, once, when the gap is over.
        tokio::time::sleep(AT_MIN_GAP + Duration::from_millis(100)).await;
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(p["type"], "presence");
        assert_eq!(p["viewers"][1]["path"], "d.md");
        assert!(brx.try_recv().is_err(), "announced once");
        let p = payload(&hrx.try_recv().unwrap());
        assert_eq!(p["type"], "presence");
        assert_eq!(p["viewers"][1]["path"], "d.md");
        r.shutdown();
    }

    #[tokio::test]
    async fn over_long_paths_and_hashes_are_ignored() {
        let long = "a".repeat(MAX_PATH_LEN + 1);
        assert!(clean_share_path(&long).is_none());
        let longest = "a".repeat(MAX_PATH_LEN);
        assert_eq!(clean_share_path(&longest), Some(longest.clone()));
        let (r, id, (ann, _arx), (_bob, mut brx), mut hrx) = placed().await;
        r.from_viewer(&id, &ann, json!({"type": "at", "path": long}));
        assert!(brx.try_recv().is_err());
        assert_eq!(path_of(&r, &id, &ann).as_deref(), Some("a.mmd"));
        r.from_viewer(&id, &ann, pointer_frame("a.mmd", &long));
        r.from_viewer(&id, &ann, pointer_frame(&long, "h"));
        assert!(hrx.try_recv().is_err(), "neither pointer went through");
        r.from_viewer(&id, &ann, pointer_frame("a.mmd", "h"));
        assert_eq!(payload(&hrx.try_recv().unwrap())["type"], "pointer");
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_pointer_counts_only_on_the_document_it_is_on() {
        let (r, id, (ann, _arx), (_bob, mut brx), mut hrx) = placed().await;
        // Ann is on a.mmd; Bob is on b.md.
        r.from_viewer(&id, &ann, pointer_frame("b.md", "h"));
        assert!(
            brx.try_recv().is_err(),
            "not shown on a document Ann isn't on"
        );
        assert!(hrx.try_recv().is_err());
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_pointer_reaches_the_host_only_with_half_its_queue_free() {
        let (r, id, (ann, _arx), _bob, _hrx) = placed().await;
        let tx = r.lock().get(&id).unwrap().host.clone().unwrap();
        for _ in 0..=QUEUE_FRAMES / 2 {
            tx.try_send(Message::Text("x".into())).unwrap();
        }
        let room = tx.capacity();
        assert!(room < QUEUE_FRAMES / 2);
        r.from_viewer(&id, &ann, pointer_frame("a.mmd", "h"));
        assert_eq!(tx.capacity(), room, "the pointer was dropped");
        assert!(!r.lock().get(&id).unwrap().host_full);
        r.shutdown();
    }

    #[tokio::test]
    async fn sticky_ink_is_kept_per_canvas_and_sent_to_a_viewer_arriving_on_the_document() {
        let (r, id, (_ann, mut arx), (bob, mut brx), _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.ink(&id, 1, stroke("f1", "a.mmd", "h", false));
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(p["type"], "ink");
        assert_eq!(p["stroke"]["id"], "s1");
        assert_eq!(payload(&arx.try_recv().unwrap())["stroke"]["id"], "f1");
        assert!(brx.try_recv().is_err());
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(p["type"], "ink");
        assert_eq!(p["stroke"]["id"], "s1");
        assert!(brx.try_recv().is_err(), "the fading stroke was not kept");
        r.shutdown();
    }

    #[tokio::test]
    async fn sticky_ink_is_bounded() {
        let (r, id, _ann, (bob, mut brx), _hrx) = placed().await;
        for i in 0..=MAX_STICKY_STROKES {
            r.ink(&id, 1, stroke(&format!("s{i}"), "a.mmd", "h", true));
        }
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let ids: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), MAX_STICKY_STROKES);
        const { assert!(MAX_STICKY_STROKES < MAX_DOC_KEPT && MAX_DOC_KEPT < QUEUE_FRAMES) };
        assert!(!ids.contains(&"s0".to_string()));
        assert!(ids.contains(&"s1".to_string()));

        for i in 0..=MAX_STICKY_CANVASES {
            r.ink(
                &id,
                1,
                stroke(&format!("c{i}"), "c.mmd", &format!("h{i}"), true),
            );
        }
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "b.md"}));
        while brx.try_recv().is_ok() {}
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "c.mmd"}));
        let ids: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), MAX_STICKY_CANVASES);
        assert!(!ids.contains(&"c0".to_string()));
        assert!(ids.contains(&"c1".to_string()));
        r.shutdown();
    }

    #[tokio::test]
    async fn ink_undo_and_clear_trim_the_kept_strokes_and_reach_viewers() {
        let (r, id, (_ann, mut arx), (bob, mut brx), _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.ink(&id, 1, stroke("s2", "a.mmd", "h", true));
        while arx.try_recv().is_ok() {}
        r.ink_undo(&id, 1, "a.mmd".into(), "h".into(), None);
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(p["type"], "inkUndo");
        assert_eq!(p["blockHash"], "h");
        assert!(brx.try_recv().is_err());
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        assert_eq!(payload(&brx.try_recv().unwrap())["stroke"]["id"], "s1");
        assert!(brx.try_recv().is_err());
        while arx.try_recv().is_ok() {}
        r.ink_clear(&id, 1, "a.mmd".into(), "h".into());
        assert_eq!(kind(&arx.try_recv().unwrap()), "inkClear");
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "b.md"}));
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let kinds: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert!(!kinds.contains(&"ink".to_string()));
        r.shutdown();
    }

    fn ink_frame(stroke: &Stroke) -> Value {
        json!({"type": "ink", "stroke": stroke})
    }

    #[tokio::test]
    async fn a_viewers_stroke_reaches_the_host_and_the_viewers_on_its_document_and_is_kept() {
        let (r, id, (ann, mut arx), (bob, mut brx), mut hrx) = placed().await;
        r.from_viewer(&id, &ann, ink_frame(&stroke("a1", "a.mmd", "h", true)));
        let h = payload(&hrx.try_recv().unwrap());
        assert_eq!(h["type"], "ink");
        assert_eq!(h["viewer"], ann);
        assert_eq!(h["stroke"]["id"], "a1");
        assert!(arx.try_recv().is_err(), "never back to its sender");
        assert!(brx.try_recv().is_err(), "Bob is on another document");
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(p["type"], "ink");
        assert_eq!(p["peer"], ann);
        assert_eq!(p["stroke"]["id"], "a1");
        // Now on the same document, Bob sees Ann's next stroke as it lands.
        forget_ink(&r, &id);
        r.from_viewer(&id, &ann, ink_frame(&stroke("a2", "a.mmd", "h", false)));
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["peer"].as_str()),
            (Some("ink"), Some(ann.as_str()))
        );
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_ink_off_its_own_document_is_dropped() {
        let (r, id, (ann, mut arx), (_bob, mut brx), mut hrx) = placed().await;
        r.from_viewer(&id, &ann, ink_frame(&stroke("x", "b.md", "h", true)));
        r.from_viewer(
            &id,
            &ann,
            json!({"type": "inking", "stroke": stroke("x", "b.md", "h", false)}),
        );
        r.from_viewer(&id, &ann, json!({"type": "ink", "stroke": {"id": "bad"}}));
        assert!(hrx.try_recv().is_err());
        assert!(arx.try_recv().is_err());
        assert!(brx.try_recv().is_err());
        assert!(r.lock().get(&id).unwrap().sticky.is_empty());
        r.shutdown();
    }

    #[tokio::test]
    async fn each_peers_undo_and_clear_touch_only_its_own_kept_strokes() {
        let (r, id, (ann, mut arx), (bob, mut brx), mut hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.ink(&id, 1, stroke("s2", "a.mmd", "h", true));
        r.from_viewer(&id, &ann, ink_frame(&stroke("a1", "a.mmd", "h", true)));
        forget_ink(&r, &id);
        r.from_viewer(&id, &ann, ink_frame(&stroke("a2", "a.mmd", "h", true)));
        while arx.try_recv().is_ok() {}
        while hrx.try_recv().is_ok() {}
        // The host's undo takes s2; Ann's takes a2.
        r.ink_undo(&id, 1, "a.mmd".into(), "h".into(), None);
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["peer"].as_str()),
            (Some("inkUndo"), Some(HOST_ID))
        );
        r.from_viewer(
            &id,
            &ann,
            json!({"type": "inkUndo", "docPath": "a.mmd", "blockHash": "h"}),
        );
        let h = payload(&hrx.try_recv().unwrap());
        assert_eq!(
            (h["type"].as_str(), h["viewer"].as_str()),
            (Some("inkUndo"), Some(ann.as_str()))
        );
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        let kept: Vec<(String, String)> = std::iter::from_fn(|| brx.try_recv().ok())
            .map(|m| payload(&m))
            .map(|p| {
                (
                    p["peer"].as_str().unwrap().into(),
                    p["stroke"]["id"].as_str().unwrap().into(),
                )
            })
            .collect();
        assert_eq!(
            kept,
            [(HOST_ID.into(), "s1".into()), (ann.clone(), "a1".into())]
        );
        // Ann's clear leaves the host's stroke.
        while hrx.try_recv().is_ok() {}
        r.from_viewer(
            &id,
            &ann,
            json!({"type": "inkClear", "docPath": "a.mmd", "blockHash": "h"}),
        );
        let p = payload(&brx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["peer"].as_str()),
            (Some("inkClear"), Some(ann.as_str()))
        );
        assert_eq!(kind(&hrx.try_recv().unwrap()), "inkClear");
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "b.md"}));
        while brx.try_recv().is_ok() {}
        forget_at(&r, &id);
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let kept: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kept, ["s1"]);
        r.shutdown();
    }

    #[tokio::test]
    async fn the_hosts_clear_wipes_every_peers_kept_strokes_on_the_canvas() {
        let (r, id, (ann, mut arx), (bob, mut brx), _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.from_viewer(&id, &ann, ink_frame(&stroke("a1", "a.mmd", "h", true)));
        r.ink(&id, 1, stroke("o1", "a.mmd", "other", true));
        while arx.try_recv().is_ok() {}
        r.ink_clear(&id, 1, "a.mmd".into(), "h".into());
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["peer"].as_str()),
            (Some("inkClear"), Some(HOST_ID))
        );
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let kept: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kept, ["o1"], "only the other canvas's stroke is left");
        assert_eq!(r.lock().get(&id).unwrap().sticky_order.len(), 1);
        r.shutdown();
    }

    #[tokio::test]
    async fn an_undo_that_names_a_stroke_takes_that_one() {
        let (r, id, (_ann, mut arx), (bob, mut brx), _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.ink(&id, 1, stroke("s2", "a.mmd", "h", true));
        while arx.try_recv().is_ok() {}
        r.ink_undo(&id, 1, "a.mmd".into(), "h".into(), Some("s1".into()));
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["strokeId"].as_str()),
            (Some("inkUndo"), Some("s1"))
        );
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let kept: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kept, ["s2"]);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_finished_strokes_are_bounded_in_size_and_rate() {
        let (r, id, (ann, _arx), _bob, mut hrx) = placed().await;
        let mut big = stroke("big", "a.mmd", "h", true);
        big.points = vec![[0.0, 0.0]; MAX_STROKE_POINTS + 1];
        r.from_viewer(&id, &ann, ink_frame(&big));
        assert!(hrx.try_recv().is_err(), "too long a stroke is dropped");
        for i in 0..5 {
            r.from_viewer(
                &id,
                &ann,
                ink_frame(&stroke(&format!("q{i}"), "a.mmd", "h", false)),
            );
        }
        assert_eq!(kind(&hrx.try_recv().unwrap()), "ink");
        assert!(
            hrx.try_recv().is_err(),
            "strokes within INK_MIN_GAP are dropped"
        );
        tokio::time::sleep(INK_MIN_GAP + Duration::from_millis(10)).await;
        r.from_viewer(&id, &ann, ink_frame(&stroke("later", "a.mmd", "h", false)));
        assert_eq!(payload(&hrx.try_recv().unwrap())["stroke"]["id"], "later");
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewer_keeps_at_most_its_quota_and_never_pushes_out_the_hosts_strokes() {
        let (r, id, (ann, _arx), (bob, mut brx), _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        for i in 0..=MAX_VIEWER_KEPT {
            forget_ink(&r, &id);
            r.from_viewer(
                &id,
                &ann,
                ink_frame(&stroke(&format!("a{i}"), "a.mmd", "h", true)),
            );
        }
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let kept: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kept.len(), MAX_VIEWER_KEPT + 1);
        assert_eq!(kept[0], "s1", "the host's stroke stays");
        assert!(
            !kept.contains(&"a0".to_string()),
            "the viewer's oldest went"
        );
        assert!(kept.contains(&"a1".to_string()));

        // Canvases: the host fills its slots, and a viewer drawing on many new canvases
        // pushes none of them out.
        for i in 1..MAX_STICKY_CANVASES {
            r.ink(
                &id,
                1,
                stroke(&format!("c{i}"), "a.mmd", &format!("h{i}"), true),
            );
        }
        for i in 0..MAX_STICKY_CANVASES + 10 {
            forget_ink(&r, &id);
            let s = stroke(&format!("f{i}"), "a.mmd", &format!("fake{i}"), true);
            r.from_viewer(&id, &ann, ink_frame(&s));
        }
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        let hosts = |hash: &str| {
            share
                .sticky
                .get(&("a.mmd".to_string(), hash.to_string()))
                .is_some_and(|s| s.iter().any(|k| k.peer == HOST_ID))
        };
        assert!(hosts("h"), "the host's first canvas stays");
        assert!((1..MAX_STICKY_CANVASES).all(|i| hosts(&format!("h{i}"))));
        drop(shares);
        r.shutdown();
    }

    fn kept_counts(r: &Relay, id: &str) -> (usize, usize) {
        let shares = r.lock();
        let all = shares.get(id).unwrap().sticky.values().flatten();
        let hosts = all.clone().filter(|k| k.peer == HOST_ID).count();
        (hosts, all.count() - hosts)
    }

    #[tokio::test]
    async fn viewers_who_come_and_go_leave_a_bounded_number_of_kept_strokes() {
        let (r, id, _ann, _bob, _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        for n in 0..4 {
            let (tx, _rx) = mpsc::channel(QUEUE_FRAMES);
            let cy = r
                .join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
                .unwrap();
            r.from_viewer(&id, &cy, json!({"type": "at", "path": "a.mmd"}));
            for i in 0..MAX_VIEWER_KEPT {
                forget_ink(&r, &id);
                let s = stroke(
                    &format!("{cy}:{i}"),
                    "a.mmd",
                    &format!("c{n}-{}", i % 7),
                    true,
                );
                r.from_viewer(&id, &cy, ink_frame(&s));
            }
            r.viewer_left(&id, &cy);
        }
        let (hosts, viewers) = kept_counts(&r, &id);
        assert_eq!(hosts, 1, "the host's stroke stays");
        assert_eq!(viewers, MAX_VIEWERS_KEPT, "the oldest of the viewers' went");
        // A host back on a new link is sent every one of them.
        let (htx, mut hrx2) = mpsc::channel(QUEUE_FRAMES);
        let resume = Resume {
            id: id.clone(),
            host_key: hostkey::host_key(b"s", &id),
        };
        r.share(2, htx, "Rob", ShareMode::ReadOnly, Some(resume))
            .ok()
            .unwrap();
        let inks = std::iter::from_fn(|| hrx2.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .count();
        assert_eq!(inks, MAX_VIEWERS_KEPT);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_documents_kept_strokes_all_reach_an_arriving_viewer() {
        let (r, id, _ann, (bob, mut brx), _hrx) = placed().await;
        // Three canvases on one document, each within its own bound: more than a queue.
        for i in 0..300 {
            let s = stroke(&format!("s{i}"), "a.mmd", &format!("h{}", i % 3), true);
            r.ink(&id, 1, s);
        }
        const { assert!(300 > QUEUE_FRAMES) };
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        let ids: Vec<String> = std::iter::from_fn(|| brx.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m)["stroke"]["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids.len(), MAX_DOC_KEPT, "the document's whole kept set");
        assert_eq!(ids.last().map(String::as_str), Some("s299"));
        assert!(!ids.contains(&"s0".to_string()), "the oldest went");
        assert_eq!(kept_counts(&r, &id).0, MAX_DOC_KEPT);
        assert!(r.lock().get(&id).unwrap().viewers.contains_key(&bob));
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewer_never_pushes_the_hosts_strokes_off_a_full_canvas_or_document() {
        let (r, id, (ann, _arx), _bob, _hrx) = placed().await;
        for i in 0..MAX_STICKY_STROKES {
            r.ink(&id, 1, stroke(&format!("s{i}"), "a.mmd", "h", true));
        }
        r.from_viewer(&id, &ann, ink_frame(&stroke("a1", "a.mmd", "h", true)));
        assert_eq!(kept_counts(&r, &id), (MAX_STICKY_STROKES, 0));
        // Another canvas of the document has room, until the document is full.
        forget_ink(&r, &id);
        r.from_viewer(&id, &ann, ink_frame(&stroke("a2", "a.mmd", "h2", true)));
        assert_eq!(kept_counts(&r, &id), (MAX_STICKY_STROKES, 1));
        for i in 0..MAX_DOC_KEPT - MAX_STICKY_STROKES {
            r.ink(&id, 1, stroke(&format!("t{i}"), "a.mmd", "h3", true));
        }
        assert_eq!(
            kept_counts(&r, &id),
            (MAX_DOC_KEPT, 0),
            "the host's strokes push a viewer's out, not its own"
        );
        forget_ink(&r, &id);
        r.from_viewer(&id, &ann, ink_frame(&stroke("a3", "a.mmd", "h2", true)));
        assert_eq!(kept_counts(&r, &id), (MAX_DOC_KEPT, 0));
        r.shutdown();
    }

    /// The host of `id` comes back on a new link as connection `conn`.
    fn resumed(r: &Arc<Relay>, id: &str, conn: u64) -> (Accepted, mpsc::Receiver<Message>) {
        let (htx, hrx) = mpsc::channel(QUEUE_FRAMES);
        let resume = Resume {
            id: id.to_string(),
            host_key: hostkey::host_key(b"s", id),
        };
        let a = r
            .share(conn, htx, "Rob", ShareMode::ReadOnly, Some(resume))
            .ok()
            .unwrap();
        (a, hrx)
    }

    fn read_frame(i: usize) -> Value {
        json!({"type": "read", "path": format!("f{i}.md"), "id": format!("r{i}")})
    }

    #[tokio::test]
    async fn names_are_cut_to_their_limit() {
        let r = relay();
        let long = "é".repeat(MAX_NAME_CHARS * 3);
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, &long, ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let (tx, mut rx) = mpsc::channel(QUEUE_FRAMES);
        r.join(&id, Some(long.clone()), json!({"type": "hello"}), tx)
            .unwrap();
        let joined = payload(&hrx.try_recv().unwrap());
        assert_eq!(
            joined["name"].as_str().unwrap().chars().count(),
            MAX_NAME_CHARS
        );
        let p = payload(&rx.try_recv().unwrap());
        assert_eq!(
            p["host"]["name"].as_str().unwrap().chars().count(),
            MAX_NAME_CHARS
        );
        assert_eq!(
            p["viewers"][0]["name"].as_str().unwrap().chars().count(),
            MAX_NAME_CHARS
        );
        r.shutdown();
    }

    #[tokio::test]
    async fn the_hosts_over_long_paths_and_hashes_are_ignored() {
        let (r, id, (_ann, mut arx), _bob, _hrx) = placed().await;
        let long = "a".repeat(MAX_PATH_LEN + 1);
        r.path(&id, 1, Some(long.clone()));
        r.slide(
            &id,
            1,
            Some(Slide {
                path: long.clone(),
                index: 1,
            }),
        );
        for (doc, hash) in [(long.as_str(), "h"), ("a.mmd", long.as_str())] {
            r.stage(
                &id,
                1,
                Some(StageRef {
                    doc_path: doc.into(),
                    block_hash: hash.into(),
                }),
            );
            r.pointer(&id, 1, Some(at(doc, hash)));
            r.ink_undo(&id, 1, doc.into(), hash.into(), None);
            r.ink_clear(&id, 1, doc.into(), hash.into());
        }
        r.ink_undo(&id, 1, "a.mmd".into(), "h".into(), Some(long.clone()));
        assert!(arx.try_recv().is_err(), "nothing was told to anyone");
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(share.host_path.is_none() && share.slide.is_none() && share.stage.is_none());
        drop(shares);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_stroke_out_of_bounds_is_dropped_whoever_drew_it() {
        let (r, id, (ann, mut arx), _bob, mut hrx) = placed().await;
        let bad = |change: fn(&mut Stroke)| {
            let mut s = stroke("bad", "a.mmd", "h", true);
            change(&mut s);
            s
        };
        let strokes = [
            bad(|s| s.color = "r".repeat(MAX_COLOR_LEN + 1)),
            bad(|s| s.width = 0.0),
            bad(|s| s.width = -2.0),
            bad(|s| s.width = MAX_STROKE_WIDTH * 2.0),
            bad(|s| s.id = "i".repeat(MAX_PATH_LEN + 1)),
            bad(|s| s.doc_path = "d".repeat(MAX_PATH_LEN + 1)),
            bad(|s| s.points = vec![[0.0, 0.0]; MAX_HOST_STROKE_POINTS + 1]),
        ];
        for s in &strokes {
            r.ink(&id, 1, s.clone());
            r.inking(&id, 1, s.clone());
            // The same from Bob, as if he were on whatever document the stroke names.
            let mut shares = r.lock();
            let share = shares.get_mut(&id).unwrap();
            share.viewers.get_mut("v2").unwrap().peer.path = Some(s.doc_path.clone());
            drop(shares);
            forget_ink(&r, &id);
            r.from_viewer(&id, "v2", ink_frame(s));
            r.from_viewer(&id, "v2", json!({"type": "inking", "stroke": s}));
        }
        assert!(arx.try_recv().is_err(), "none was shown");
        assert!(hrx.try_recv().is_err());
        assert_eq!(kept_counts(&r, &id), (0, 0), "none was kept");
        // The host's stroke may be longer than a viewer's.
        let mut long = stroke("long", "a.mmd", "h", true);
        long.points = vec![[0.0, 0.0]; MAX_HOST_STROKE_POINTS];
        r.ink(&id, 1, long);
        assert_eq!(kind(&arx.try_recv().unwrap()), "ink");
        let _ = ann;
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewer_who_leaves_while_the_host_is_away_leaves_nothing_for_it() {
        let (r, id, (ann, _arx), _bob, _hrx) = crowd().await;
        r.host_dropped(&id, 1);
        let (tx, _crx) = mpsc::channel(QUEUE_FRAMES);
        let cy = r
            .join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
            .unwrap();
        for who in [&ann, &cy] {
            r.from_viewer(&id, who, read_frame(1));
            r.viewer_left(&id, who);
        }
        assert!(
            r.lock()
                .get(&id)
                .unwrap()
                .buffered
                .keys()
                .all(|k| k == HOST_ID)
        );
        let (a, _hrx) = resumed(&r, &id, 2);
        for frame in &a.replay {
            let v: Value = serde_json::from_str(frame).unwrap();
            assert_eq!(v["type"], "presence", "{frame}");
        }
        r.shutdown();
    }

    #[tokio::test]
    async fn a_flood_while_the_host_is_away_never_pushes_out_who_the_viewer_is() {
        let (r, id, _ann, _bob, _hrx) = crowd().await;
        r.host_dropped(&id, 1);
        let (tx, _crx) = mpsc::channel(QUEUE_FRAMES);
        let cy = r
            .join(&id, Some("Cy".into()), json!({"type": "hello"}), tx)
            .unwrap();
        for i in 0..BUFFER_PER_VIEWER * 2 {
            r.from_viewer(&id, &cy, read_frame(i));
        }
        let (a, _hrx) = resumed(&r, &id, 2);
        let mine: Vec<Value> = a
            .replay
            .iter()
            .map(|f| serde_json::from_str::<Value>(f).unwrap())
            .filter(|v| v["viewer"] == cy.as_str())
            .collect();
        assert_eq!(mine[0]["type"], "joined");
        assert_eq!(mine[1]["msg"]["type"], "hello");
        assert_eq!(mine.len(), BUFFER_PER_VIEWER + 2);
        let last = format!("f{}.md", BUFFER_PER_VIEWER * 2 - 1);
        assert_eq!(mine.last().unwrap()["msg"]["path"], last.as_str());
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewer_flooding_the_host_is_closed_and_the_host_is_never_marked_behind() {
        let (r, id, (ann, mut arx), (bob, _brx), mut hrx) = crowd().await;
        // An honest burst goes through whole.
        for i in 0..100 {
            r.from_viewer(&id, &bob, read_frame(i));
        }
        let got = std::iter::from_fn(|| hrx.try_recv().ok()).count();
        assert_eq!(got, 100);
        // A flood, with the host reading nothing meanwhile.
        for i in 0..QUEUE_FRAMES * 8 {
            r.from_viewer(&id, &ann, read_frame(i));
        }
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(
            share.host.is_some() && !share.host_full,
            "the host is still here"
        );
        assert!(share.grace_timer.is_none());
        assert!(!share.viewers.contains_key(&ann), "the flooder is gone");
        assert!(share.viewers.contains_key(&bob));
        drop(shares);
        let kinds: Vec<String> = std::iter::from_fn(|| arx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(kinds.last().map(String::as_str), Some("close"));
        let host: Vec<Value> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| payload(&m))
            .collect();
        assert!(host.len() < QUEUE_FRAMES, "the host's queue never filled");
        assert!(
            host.iter()
                .any(|m| m["type"] == "left" && m["viewer"] == ann.as_str())
        );
        r.shutdown();
    }

    #[tokio::test]
    async fn a_viewers_message_is_not_forwarded_into_the_hosts_last_room() {
        let (r, id, (ann, mut arx), (bob, _brx), _hrx) = crowd().await;
        let tx = r.lock().get(&id).unwrap().host.clone().unwrap();
        while tx.capacity() > HOST_RESERVE {
            tx.try_send(Message::Text("x".into())).unwrap();
        }
        r.from_viewer(&id, &ann, read_frame(1));
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(share.host.is_some() && !share.host_full);
        assert!(
            !share.viewers.contains_key(&ann),
            "closed rather than queued"
        );
        assert!(share.viewers.contains_key(&bob));
        drop(shares);
        // `left` and presence took two of the reserved places; the read took none.
        assert_eq!(tx.capacity(), HOST_RESERVE - 2);
        let kinds: Vec<String> = std::iter::from_fn(|| arx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(kinds, ["close"]);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_resumed_host_starts_without_its_old_slide_canvas_and_path() {
        for replaced in [false, true] {
            let (r, id, (_ann, mut arx), _bob, _hrx) = placed().await;
            r.path(&id, 1, Some("deck.md".into()));
            r.slide(
                &id,
                1,
                Some(Slide {
                    path: "deck.md".into(),
                    index: 4,
                }),
            );
            r.stage(
                &id,
                1,
                Some(StageRef {
                    doc_path: "a.mmd".into(),
                    block_hash: "h".into(),
                }),
            );
            // The link drops (or is replaced while the relay still thinks it is up), and
            // the host closes its deck and canvas before it is back.
            if !replaced {
                r.host_dropped(&id, 1);
            }
            while arx.try_recv().is_ok() {}
            let (_a, _hrx2) = resumed(&r, &id, 2);
            let last = std::iter::from_fn(|| arx.try_recv().ok())
                .filter(|m| kind(m) == "presence")
                .last()
                .map(|m| payload(&m))
                .expect("viewers are told");
            assert!(last["slide"].is_null(), "{last}");
            assert!(last["stage"].is_null(), "{last}");
            assert!(last.get("hostPath").is_none_or(Value::is_null), "{last}");
            r.shutdown();
        }
    }

    #[tokio::test]
    async fn a_viewers_ink_never_marks_the_host_behind() {
        let (r, id, (ann, _arx), _bob, _hrx) = placed().await;
        for i in 0..(QUEUE_FRAMES * 2) {
            forget_ink(&r, &id);
            r.from_viewer(
                &id,
                &ann,
                ink_frame(&stroke(&format!("f{i}"), "a.mmd", "h", false)),
            );
            r.from_viewer(
                &id,
                &ann,
                json!({"type": "inkUndo", "docPath": "a.mmd", "blockHash": "h"}),
            );
        }
        let shares = r.lock();
        let share = shares.get(&id).unwrap();
        assert!(!share.host_full && share.host.is_some());
        assert!(
            share.buffered.values().all(|q| q.frames.is_empty()),
            "ink is never buffered"
        );
        drop(shares);
        r.shutdown();
    }

    #[tokio::test]
    async fn a_host_back_on_a_new_link_gets_the_viewers_kept_strokes() {
        let (r, id, (ann, _arx), _bob, _hrx) = placed().await;
        r.ink(&id, 1, stroke("s1", "a.mmd", "h", true));
        r.from_viewer(&id, &ann, ink_frame(&stroke("a1", "a.mmd", "h", true)));
        let (htx, mut hrx2) = mpsc::channel(QUEUE_FRAMES);
        let resume = Resume {
            id: id.clone(),
            host_key: hostkey::host_key(b"s", &id),
        };
        r.share(2, htx, "Rob", ShareMode::ReadOnly, Some(resume))
            .ok()
            .unwrap();
        let inks: Vec<(String, String)> = std::iter::from_fn(|| hrx2.try_recv().ok())
            .filter(|m| kind(m) == "ink")
            .map(|m| payload(&m))
            .map(|p| {
                (
                    p["viewer"].as_str().unwrap().into(),
                    p["stroke"]["id"].as_str().unwrap().into(),
                )
            })
            .collect();
        assert_eq!(
            inks,
            [(ann.clone(), "a1".into())],
            "the host's own it still has"
        );
        r.shutdown();
    }

    #[tokio::test]
    async fn inking_frames_from_a_viewer_are_thinned() {
        let (r, id, (ann, _arx), _bob, mut hrx) = placed().await;
        for i in 0..5 {
            let s = stroke(&format!("d{i}"), "a.mmd", "h", false);
            r.from_viewer(&id, &ann, json!({"type": "inking", "stroke": s}));
        }
        assert_eq!(kind(&hrx.try_recv().unwrap()), "inking");
        assert!(hrx.try_recv().is_err());
        tokio::time::sleep(INKING_MIN_GAP + Duration::from_millis(10)).await;
        let s = stroke("d9", "a.mmd", "h", false);
        r.from_viewer(&id, &ann, json!({"type": "inking", "stroke": s}));
        assert_eq!(payload(&hrx.try_recv().unwrap())["stroke"]["id"], "d9");
        r.shutdown();
    }

    #[tokio::test]
    async fn inking_frames_are_passed_on_and_never_kept() {
        let (r, id, (ann, mut arx), (bob, mut brx), mut hrx) = placed().await;
        r.inking(&id, 1, stroke("s1", "a.mmd", "h", true));
        let p = payload(&arx.try_recv().unwrap());
        assert_eq!(
            (p["type"].as_str(), p["peer"].as_str()),
            (Some("inking"), Some(HOST_ID))
        );
        assert!(brx.try_recv().is_err());
        r.from_viewer(
            &id,
            &ann,
            json!({"type": "inking", "stroke": stroke("a1", "a.mmd", "h", false)}),
        );
        let h = payload(&hrx.try_recv().unwrap());
        assert_eq!(
            (h["type"].as_str(), h["viewer"].as_str()),
            (Some("inking"), Some(ann.as_str()))
        );
        assert!(arx.try_recv().is_err());
        let mut big = stroke("a2", "a.mmd", "h", false);
        big.points = vec![[0.0, 0.0]; MAX_INKING_POINTS + 1];
        forget_ink(&r, &id);
        r.from_viewer(&id, &ann, json!({"type": "inking", "stroke": big}));
        assert!(hrx.try_recv().is_err(), "an oversize frame is dropped");
        r.from_viewer(&id, &bob, json!({"type": "at", "path": "a.mmd"}));
        assert_eq!(kind(&brx.try_recv().unwrap()), "presence");
        assert!(brx.try_recv().is_err(), "nothing in progress is kept");
        r.shutdown();
    }

    #[tokio::test]
    async fn shared_announces_the_presence_capability() {
        let r = relay();
        let (htx, _hrx) = mpsc::channel(QUEUE_FRAMES);
        let a = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap();
        match serde_json::from_value::<RelayToHost>(payload(&a.shared)).unwrap() {
            RelayToHost::Shared { capabilities, .. } => assert_eq!(capabilities, ["presence"]),
            other => panic!("{other:?}"),
        }
        r.shutdown();
    }

    #[test]
    fn clean_share_path_accepts_relative_paths_only() {
        assert_eq!(clean_share_path("docs/a.md").as_deref(), Some("docs/a.md"));
        assert_eq!(
            clean_share_path("./docs//a.md").as_deref(),
            Some("docs/a.md")
        );
        for bad in ["", "../a", "/a", "a/../b", "a\\b", "."] {
            assert!(clean_share_path(bad).is_none(), "{bad}");
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
        assert_eq!(
            host,
            ["joined", "fromViewer", "presence", "left", "presence"]
        );
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
        assert_eq!(a.replay.len(), 2);
        assert!(a.replay[0].contains("\"hello\""), "{:?}", a.replay);
        assert!(a.replay[1].contains("\"presence\""), "{:?}", a.replay);
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
    async fn a_fetch_past_the_cap_waits_for_a_slot() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let open: Vec<Started> = (0..MAX_FETCHES)
            .map(|_| r.start_fetch(&id, "a.png".into(), None).ok().unwrap())
            .collect();
        // No slot comes free: the wait ends, and only then is it refused.
        let short = Duration::from_millis(50);
        assert_eq!(
            r.start_fetch_when_free(&id, "b.png".into(), None, short)
                .await
                .err(),
            Some(FetchRefused::Busy)
        );
        // One does: the waiting fetch takes it.
        let waiting = {
            let (r, id) = (r.clone(), id.clone());
            tokio::spawn(async move {
                r.start_fetch_when_free(&id, "c.png".into(), None, Duration::from_secs(5))
                    .await
            })
        };
        tokio::time::sleep(short).await;
        assert!(!waiting.is_finished());
        r.fetch_bytes(&id, 1, open[0].req, Bytes::new());
        let started = waiting.await.unwrap().ok().unwrap();
        let asked: Vec<Value> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| payload(&m))
            .collect();
        assert_eq!(asked.len(), MAX_FETCHES + 1);
        assert_eq!(asked.last().unwrap()["path"], "c.png");
        assert_eq!(asked.last().unwrap()["req"], started.req);
        // A share that ends tells its waiting fetches so at once.
        let waiting = {
            let (r, id) = (r.clone(), id.clone());
            tokio::spawn(async move {
                r.start_fetch_when_free(&id, "d.png".into(), None, Duration::from_secs(5))
                    .await
            })
        };
        tokio::time::sleep(short).await;
        r.end(&id, 1);
        assert_eq!(waiting.await.unwrap().err(), Some(FetchRefused::Gone));
        r.shutdown();
    }

    #[tokio::test]
    async fn a_host_that_obeys_pause_is_never_cut_off() {
        let r = relay();
        let (htx, mut hrx) = mpsc::channel(QUEUE_FRAMES);
        let id = r
            .share(1, htx, "Rob", ShareMode::ReadOnly, None)
            .ok()
            .unwrap()
            .id;
        let f = r.start_fetch(&id, "v.mp4".into(), None).ok().unwrap();
        for _ in 0..PAUSE_AT {
            r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        }
        // What the host had sent before `pause` reached it: its whole out-queue (32
        // chunks, `OUT_QUEUE` in sharing.rs), the chunk in its hand, and as much again
        // sitting in the sockets on the way.
        for _ in 0..2 * (32 + 1) {
            r.fetch_bytes(&id, 1, f.req, Bytes::from_static(b"x"));
        }
        let host: Vec<String> = std::iter::from_fn(|| hrx.try_recv().ok())
            .map(|m| kind(&m))
            .collect();
        assert_eq!(host, ["fetch", "pause"], "paused, not cancelled");
        assert_eq!(f.body.len(), PAUSE_AT + 66);
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
