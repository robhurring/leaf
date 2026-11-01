//! The relay's shares: one host link and its viewers each, and every change to them.
//!
//! All state sits behind one lock and every transition is synchronous: sockets are fed
//! through unbounded channels, so nothing awaits while the lock is held, and frames meant
//! for the host keep their order (a resumed host gets `Shared`, then the buffered frames,
//! then whatever comes next).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message};
use leaf_protocol::relay::{Peer, RelayToHost, Resume, ShareInfo, ShareMode};
use leaf_protocol::{ServerMessage, ShareState};
use serde_json::Value;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;

use super::limits::Limits;
use super::{hostkey, urls, words};

/// The host's peer id in presence and share info.
pub const HOST_ID: &str = "host";
/// Frames kept per viewer while the host is away; older ones are dropped.
pub const BUFFER_PER_VIEWER: usize = 64;

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

/// Why a host's `share` was refused: the `RelayToHost::Error` to send before closing.
pub struct Refused {
    pub code: &'static str,
    pub message: String,
}

struct Viewer {
    seq: u64,
    peer: Peer,
    tx: UnboundedSender<Message>,
}

pub struct Share {
    host: Option<UnboundedSender<Message>>,
    /// Which host connection owns this share (the one live now, or the one that dropped).
    host_conn: u64,
    viewers: HashMap<String, Viewer>,
    /// Frames for the host from each viewer while it is away, replayed on resume.
    buffered: HashMap<String, VecDeque<String>>,
    info: ShareInfo,
    host_path: Option<String>,
    grace_timer: Option<JoinHandle<()>>,
}

impl Share {
    fn for_host(&mut self, viewer: &str, msg: &RelayToHost) {
        let frame = serde_json::to_string(msg).unwrap_or_default();
        match &self.host {
            Some(tx) => {
                let _ = tx.send(Message::Text(frame.into()));
            }
            None => {
                let q = self.buffered.entry(viewer.to_string()).or_default();
                if q.len() == BUFFER_PER_VIEWER {
                    q.pop_front();
                }
                q.push_back(frame);
            }
        }
    }

    fn peers(&self) -> Vec<Peer> {
        let mut v: Vec<&Viewer> = self.viewers.values().collect();
        v.sort_by_key(|v| v.seq);
        v.into_iter().map(|v| v.peer.clone()).collect()
    }

    fn presence(&self) {
        let viewers = self.peers();
        for (id, v) in &self.viewers {
            let _ = v.tx.send(text(&ServerMessage::Presence {
                host: self.info.host.clone(),
                host_path: self.host_path.clone(),
                viewers: viewers.clone(),
                you: id.clone(),
                in_reply_to: None,
            }));
        }
    }

    fn status(&self, state: ShareState, reason: Option<&str>) {
        for v in self.viewers.values() {
            let _ = v.tx.send(status(state, reason));
        }
    }

    /// Tells every viewer the share ended and closes them; their tasks end as the channels drain.
    fn close_all(mut self, reason: &str) {
        if let Some(t) = self.grace_timer.take() {
            t.abort();
        }
        for v in self.viewers.values() {
            let _ = v.tx.send(status(ShareState::Ended, Some(reason)));
            let _ = v.tx.send(Message::Close(None));
        }
        if let Some(h) = &self.host {
            let _ = h.send(Message::Close(None));
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
    pub limits: Limits,
    next_viewer: AtomicU64,
    next_conn: AtomicU64,
}

impl Relay {
    pub fn new(secret: Vec<u8>, grace: Duration, public_url: String) -> Relay {
        Relay {
            shares: Mutex::new(HashMap::new()),
            secret,
            grace,
            public_url,
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

    /// A host's `share`: a new share, or the resume of one (in grace, or lost to a restart).
    /// Sends the host `Shared`, then anything its viewers said while it was away.
    pub fn share(
        self: &Arc<Self>,
        conn: u64,
        tx: UnboundedSender<Message>,
        name: &str,
        mode: ShareMode,
        resume: Option<Resume>,
    ) -> Result<String, Refused> {
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
                if shares.get(&id).is_some_and(|s| s.host.is_some()) {
                    tracing::warn!(share = %id, "resume refused: the share has a live host");
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
        let shared = RelayToHost::Shared {
            id: id.clone(),
            host_key: hostkey::host_key(&self.secret, &id),
            web_url: web_url.clone(),
            app_url: app_url.clone(),
        };
        let _ = tx.send(text(&shared));
        match shares.get_mut(&id) {
            Some(share) => {
                if let Some(t) = share.grace_timer.take() {
                    t.abort();
                }
                share.host_conn = conn;
                share.info.host = host;
                share.info.mode = mode;
                let mut queued: Vec<(String, VecDeque<String>)> = share.buffered.drain().collect();
                queued.sort_by_key(|(v, _)| viewer_seq(v));
                for frame in queued.into_iter().flat_map(|(_, q)| q) {
                    let _ = tx.send(Message::Text(frame.into()));
                }
                share.host = Some(tx);
                share.status(ShareState::Live, None);
                share.presence();
                tracing::info!(share = %id, viewers = share.viewers.len(), "host resumed");
            }
            None => {
                shares.insert(
                    id.clone(),
                    Share {
                        host: Some(tx),
                        host_conn: conn,
                        viewers: HashMap::new(),
                        buffered: HashMap::new(),
                        info: ShareInfo {
                            id: id.clone(),
                            host,
                            mode,
                            web_url,
                            app_url,
                        },
                        host_path: None,
                        grace_timer: None,
                    },
                );
                tracing::info!(share = %id, "shared");
            }
        }
        Ok(id)
    }

    /// The host's `toViewer`: patch a welcome, deliver, and expel on a per-viewer `ended`.
    pub fn to_viewer(&self, id: &str, conn: u64, viewer: &str, mut msg: Value) {
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
        let _ = v.tx.send(text(&msg));
        if expel {
            let _ = v.tx.send(Message::Close(None));
            share.viewers.remove(viewer);
            tracing::info!(share = %id, viewer, "viewer expelled by the host");
            share.for_host(
                viewer,
                &RelayToHost::Left {
                    viewer: viewer.to_string(),
                },
            );
            share.presence();
        }
    }

    /// The host's `path`: what it is reading now.
    pub fn path(&self, id: &str, conn: u64, path: Option<String>) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) {
            share.host_path = path;
            share.presence();
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

    /// The host link dropped without `end`: viewers wait `grace` for it to come back.
    pub fn host_dropped(self: &Arc<Self>, id: &str, conn: u64) {
        let mut shares = self.lock();
        let Some(share) = shares.get_mut(id).filter(|s| s.host_conn == conn) else {
            return;
        };
        share.host = None;
        share.status(ShareState::Reconnecting, None);
        let relay = Arc::clone(self);
        let grace = self.grace;
        let key = id.to_string();
        share.grace_timer = Some(tokio::spawn(async move {
            tokio::time::sleep(grace).await;
            relay.grace_over(&key, conn);
        }));
        tracing::info!(share = %id, grace_ms = self.grace.as_millis() as u64, "host dropped; waiting");
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
    /// None when the share is gone.
    pub fn join(
        &self,
        id: &str,
        name: Option<String>,
        hello: Value,
        tx: UnboundedSender<Message>,
    ) -> Option<String> {
        let mut shares = self.lock();
        let share = shares.get_mut(id)?;
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
        if share.host.is_none() {
            let _ = tx.send(status(ShareState::Reconnecting, None));
        }
        share.viewers.insert(vid.clone(), Viewer { seq, peer, tx });
        share.presence();
        tracing::info!(share = %id, viewer = %vid, viewers = share.viewers.len(), "viewer joined");
        Some(vid)
    }

    /// A viewer's message, for the host (or its buffer while the host is away).
    pub fn from_viewer(&self, id: &str, viewer: &str, msg: Value) {
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
        }
    }

    /// A viewer's socket closed. Nothing to do when it was already expelled or the share ended.
    pub fn viewer_left(&self, id: &str, viewer: &str) {
        let mut shares = self.lock();
        if let Some(share) = shares.get_mut(id)
            && share.viewers.remove(viewer).is_some()
        {
            share.for_host(
                viewer,
                &RelayToHost::Left {
                    viewer: viewer.to_string(),
                },
            );
            share.presence();
            tracing::info!(share = %id, viewer, viewers = share.viewers.len(), "viewer left");
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
