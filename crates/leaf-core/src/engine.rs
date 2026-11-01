//! The transport-free heart: sessions, the hello handshake, subscriptions, and
//! the fan-out of changes. A window, a socket, and a relay peer are all just
//! sessions; whatever delivers the messages is someone else's problem.
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use leaf_protocol::{
    ClientMessage, Config, Encoding, ErrorCode, PROTOCOL_VERSION, Participant, ServerMessage,
};
use tokio::sync::broadcast;

use crate::prefs::PreferencesStore;
use crate::source::{FileData, Source, SourceError};
use crate::watch::ChangeEvent;

/// The most lines a text search returns.
const TEXT_HITS: usize = 200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SessionId(pub u64);

#[derive(Clone, Debug, Default)]
pub struct EngineConfig {
    pub plantuml_url: Option<String>,
    pub mention_url: Option<String>,
    pub topic_url: Option<String>,
    pub max_entries: usize,
    /// The relay that Share uses (sent in the welcome); none: no Share button.
    pub relay_url: Option<String>,
    /// Where file bytes are served instead of the source's `/raw/` (the app's own URLs).
    pub raw_base: Option<String>,
}

#[derive(Default)]
struct Session {
    greeted: bool,
    closed: bool,
    subscriptions: HashSet<String>,
}

impl Session {
    /// Subscribed to `path` exactly, to everything (`""`), or to a folder containing it.
    fn subscribed_to(&self, path: &str) -> bool {
        self.subscriptions
            .iter()
            .any(|s| s.is_empty() || s == path || path.starts_with(&format!("{s}/")))
    }
}

pub struct Engine {
    source: Arc<dyn Source>,
    prefs: Arc<PreferencesStore>,
    config: EngineConfig,
    sessions: Mutex<HashMap<SessionId, Session>>,
    next_id: AtomicU64,
    pushes: broadcast::Sender<(SessionId, ServerMessage)>,
}

fn raw_url(base: &str, path: &str) -> String {
    let encoded: Vec<String> = path
        .split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect::<String>()
        })
        .collect();
    format!("{base}{}", encoded.join("/"))
}

fn file_message(base: &str, f: FileData) -> ServerMessage {
    let url = raw_url(base, &f.path);
    ServerMessage::File {
        path: f.path,
        kind: f.kind,
        lang: f.lang,
        mime: f.mime,
        encoding: f.encoding,
        content: if f.encoding == Encoding::None {
            None
        } else {
            f.content
        },
        url,
        size: f.size,
        mtime: f.mtime,
        created: f.created,
        git: f.git,
        in_reply_to: None,
    }
}

fn error_message(e: SourceError) -> ServerMessage {
    ServerMessage::Error {
        code: e.code,
        message: e.message,
        path: e.path,
        in_reply_to: None,
    }
}

impl Engine {
    pub fn new(
        source: Arc<dyn Source>,
        prefs: Arc<PreferencesStore>,
        config: EngineConfig,
    ) -> Arc<Engine> {
        let (pushes, _) = broadcast::channel(1024);
        Arc::new(Engine {
            source,
            prefs,
            config,
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            pushes,
        })
    }

    pub fn source(&self) -> &Arc<dyn Source> {
        &self.source
    }

    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<SessionId, Session>> {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn connect(&self) -> SessionId {
        let id = SessionId(self.next_id.fetch_add(1, Ordering::Relaxed));
        self.sessions().insert(id, Session::default());
        tracing::info!(
            client = id.0,
            clients = self.client_count(),
            "client connected"
        );
        id
    }

    pub fn disconnect(&self, session: SessionId) {
        if self.sessions().remove(&session).is_some() {
            tracing::info!(
                client = session.0,
                clients = self.client_count(),
                "client disconnected"
            );
        }
    }

    /// Sessions that have connected and not disconnected (closed ones count until removed).
    pub fn client_count(&self) -> usize {
        self.sessions().len()
    }

    /// True once the session was refused (a message before `hello`); the transport should drop it.
    pub fn is_closed(&self, session: SessionId) -> bool {
        self.sessions().get(&session).is_none_or(|s| s.closed)
    }

    /// Pushes (`changed`, later presence) addressed per session.
    pub fn pushes(&self) -> broadcast::Receiver<(SessionId, ServerMessage)> {
        self.pushes.subscribe()
    }

    /// Fans a disk change out to every session subscribed to its path (or, for a rename, its old path).
    pub fn feed_change(&self, ev: ChangeEvent) {
        let msg = ServerMessage::Changed {
            path: ev.path.clone(),
            change: ev.change,
            from: ev.from.clone(),
            in_reply_to: None,
        };
        let targets: Vec<SessionId> = self
            .sessions()
            .iter()
            .filter(|(_, s)| {
                !s.closed
                    && s.greeted
                    && (s.subscribed_to(&ev.path)
                        || ev.from.as_deref().is_some_and(|f| s.subscribed_to(f)))
            })
            .map(|(id, _)| *id)
            .collect();
        tracing::info!(path = %ev.path, change = ?ev.change, from = ?ev.from, "changed");
        for id in targets {
            let _ = self.pushes.send((id, msg.clone()));
        }
    }

    /// Handles one client message; the replies come back in order.
    pub async fn handle(&self, session: SessionId, msg: ClientMessage) -> Vec<ServerMessage> {
        let id = msg.id().map(str::to_string);
        tracing::debug!(client = session.0, msg = ?msg, "recv");
        {
            let mut sessions = self.sessions();
            let Some(s) = sessions.get_mut(&session) else {
                return vec![];
            };
            if s.closed {
                return vec![];
            }
            if !s.greeted {
                if let ClientMessage::Hello { protocol, .. } = &msg {
                    if *protocol != PROTOCOL_VERSION {
                        s.closed = true;
                        tracing::warn!(
                            client = session.0,
                            protocol,
                            "unsupported protocol version; closing"
                        );
                        return vec![
                            ServerMessage::error(
                                ErrorCode::BadRequest,
                                format!("unsupported protocol version {protocol}; this server speaks {PROTOCOL_VERSION}"),
                                None,
                            )
                            .in_reply_to(id.as_deref()),
                        ];
                    }
                    s.greeted = true;
                } else {
                    s.closed = true;
                    tracing::warn!(client = session.0, "message before hello; closing");
                    return vec![
                        ServerMessage::error(
                            ErrorCode::BadRequest,
                            "first message must be hello",
                            None,
                        )
                        .in_reply_to(id.as_deref()),
                    ];
                }
            }
        }
        let reply = match msg {
            ClientMessage::Hello { .. } => {
                vec![ServerMessage::Welcome {
                    protocol: PROTOCOL_VERSION,
                    root: self.source.root(),
                    config: Config {
                        plantuml_url: self.config.plantuml_url.clone(),
                        mention_url: self.config.mention_url.clone(),
                        topic_url: self.config.topic_url.clone(),
                        max_entries: Some(self.config.max_entries as u64),
                        relay_url: self.config.relay_url.clone(),
                    },
                    capabilities: {
                        let mut c = self.source.capabilities();
                        if let Some(base) = &self.config.raw_base {
                            c.raw_urls = Some(true);
                            c.raw_base = Some(base.clone());
                        }
                        c
                    },
                    participant: Participant {
                        id: "local".into(),
                        name: "You".into(),
                        color: None,
                    },
                    preferences: Some(self.prefs.load().await),
                    share: None,
                    in_reply_to: None,
                }]
            }
            ClientMessage::List { path, .. } => {
                let path = path.unwrap_or_default();
                match self.source.list(&path).await {
                    Ok(entries) => vec![ServerMessage::Tree {
                        path,
                        entries,
                        in_reply_to: None,
                    }],
                    Err(e) => vec![error_message(e)],
                }
            }
            ClientMessage::Read { path, .. } => match self.source.read(&path).await {
                Ok(f) => {
                    tracing::info!(path = %path, "opened");
                    let base = self.config.raw_base.as_deref().unwrap_or("/raw/");
                    vec![file_message(base, f)]
                }
                Err(e) => vec![error_message(e)],
            },
            ClientMessage::Subscribe { path, .. } => {
                if let Some(s) = self.sessions().get_mut(&session) {
                    s.subscriptions.insert(path);
                }
                vec![]
            }
            ClientMessage::Unsubscribe { path, .. } => {
                if let Some(s) = self.sessions().get_mut(&session) {
                    s.subscriptions.remove(&path);
                }
                vec![]
            }
            ClientMessage::Search { q, limit, .. } => {
                let cap = self.config.max_entries;
                let limit = limit.map(|l| l as usize).unwrap_or(cap).min(cap);
                match self.source.search(&q, limit).await {
                    Ok(entries) => vec![ServerMessage::Matches {
                        q,
                        entries,
                        in_reply_to: None,
                    }],
                    Err(e) => vec![error_message(e)],
                }
            }
            ClientMessage::SearchText { q, limit, .. } => {
                let limit = limit
                    .map(|l| l as usize)
                    .unwrap_or(TEXT_HITS)
                    .min(TEXT_HITS);
                match self.source.search_text(&q, limit).await {
                    Ok(hits) => vec![ServerMessage::TextMatches {
                        q,
                        hits,
                        in_reply_to: None,
                    }],
                    Err(e) => vec![error_message(e)],
                }
            }
            ClientMessage::Preferences { preferences, .. } => {
                self.prefs.save(preferences).await;
                vec![]
            }
            ClientMessage::Blame { path, .. } => match self.source.blame(&path).await {
                Ok(blame) => {
                    let (hunks, repo_url) =
                        blame.map(|b| (b.hunks, b.repo_url)).unwrap_or_default();
                    vec![ServerMessage::BlameHunks {
                        path,
                        hunks,
                        repo_url,
                        in_reply_to: None,
                    }]
                }
                Err(e) => vec![error_message(e)],
            },
        };
        for m in &reply {
            tracing::debug!(client = session.0, msg = ?m, "send");
        }
        reply
            .into_iter()
            .map(|m| m.in_reply_to(id.as_deref()))
            .collect()
    }
}
