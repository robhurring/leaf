//! App windows over the core: each window is one Engine session, windows on the
//! same folder share one Engine (and one watcher), and pushes go only to the window
//! they belong to. No Tauri in here, so it is testable without a webview; the app
//! wires `emit` to Tauri events.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use leaf_core::config::Config;
use leaf_core::engine::{Engine, SessionId};
use leaf_core::watch::Watcher;
use leaf_protocol::{ClientMessage, ServerMessage};

use crate::serve::{Built, build_engine};

pub type Emit = Arc<dyn Fn(&str, ServerMessage) + Send + Sync>;

struct Folder {
    engine: Arc<Engine>,
    _watcher: Option<Watcher>,
    forwarder: tokio::task::JoinHandle<()>,
    windows: usize,
}

struct Inner {
    folders: HashMap<PathBuf, Folder>,
    /// label → (folder, session)
    windows: HashMap<String, (PathBuf, SessionId)>,
}

pub struct Windows {
    config: Config,
    emit: Emit,
    inner: Arc<Mutex<Inner>>,
}

impl Windows {
    pub fn new(config: Config, emit: Emit) -> Windows {
        Windows {
            config,
            emit,
            inner: Arc::new(Mutex::new(Inner {
                folders: HashMap::new(),
                windows: HashMap::new(),
            })),
        }
    }

    /// The event a window's `TauriSource` listens on.
    pub fn event_name(label: &str) -> String {
        format!("leaf://message/{label}")
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn engine_count(&self) -> usize {
        self.lock().folders.len()
    }

    /// The folder a target lives in (itself for a folder); document paths are relative to it.
    pub fn folder_of(target: &Path) -> PathBuf {
        if target.is_dir() {
            target.to_path_buf()
        } else {
            target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| target.to_path_buf())
        }
    }

    /// Registers window `label` on `target` (a folder or a file in it). Must run inside a tokio runtime.
    pub fn open(&self, label: &str, target: &Path) -> Result<(), String> {
        // Keyed by what was opened: a single file gets a file-rooted source, so its window
        // shows that file (no tree), not the folder around it.
        let folder = target.to_path_buf();
        let mut inner = self.lock();
        if !inner.folders.contains_key(&folder) {
            let config = Config {
                target: folder.clone(),
                ..self.config.clone()
            };
            let Built {
                engine, watcher, ..
            } = build_engine(&config, Some(crate::raw::RAW_BASE)).map_err(|e| e.0)?;
            let forwarder = {
                let mut pushes = engine.pushes();
                let inner = self.inner.clone();
                let emit = self.emit.clone();
                let key = folder.clone();
                tokio::spawn(async move {
                    loop {
                        match pushes.recv().await {
                            Ok((sid, msg)) => {
                                let label = {
                                    let i = inner.lock().unwrap_or_else(|e| e.into_inner());
                                    i.windows
                                        .iter()
                                        .find(|(_, (f, s))| *f == key && *s == sid)
                                        .map(|(l, _)| l.clone())
                                };
                                if let Some(label) = label {
                                    emit(&label, msg);
                                }
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                })
            };
            inner.folders.insert(
                folder.clone(),
                Folder {
                    engine,
                    _watcher: watcher,
                    forwarder,
                    windows: 0,
                },
            );
        }
        let f = inner.folders.get_mut(&folder).expect("just inserted");
        f.windows += 1;
        let sid = f.engine.connect();
        inner.windows.insert(label.to_string(), (folder, sid));
        Ok(())
    }

    /// Handles a message from window `label`; the replies, for the caller to emit.
    pub async fn send(&self, label: &str, msg: ClientMessage) -> Vec<ServerMessage> {
        let found = {
            let inner = self.lock();
            inner
                .windows
                .get(label)
                .and_then(|(f, sid)| inner.folders.get(f).map(|fo| (fo.engine.clone(), *sid)))
        };
        match found {
            Some((engine, sid)) => engine.handle(sid, msg).await,
            None => vec![],
        }
    }

    /// Where `path` is on disk, for window `label`: inside the folder it shows, or an error.
    pub async fn locate(&self, label: &str, path: &str) -> Result<PathBuf, String> {
        let engine = {
            let inner = self.lock();
            inner
                .windows
                .get(label)
                .and_then(|(f, _)| inner.folders.get(f).map(|fo| fo.engine.clone()))
        };
        let engine = engine.ok_or_else(|| format!("no window {label}"))?;
        engine.source().locate(path).await.map_err(|e| e.message)
    }

    /// The window went away: end its session; the last window on a folder releases the engine.
    pub fn close(&self, label: &str) {
        let mut inner = self.lock();
        let Some((folder, sid)) = inner.windows.remove(label) else {
            return;
        };
        let release = match inner.folders.get_mut(&folder) {
            Some(f) => {
                f.engine.disconnect(sid);
                f.windows -= 1;
                f.windows == 0
            }
            None => false,
        };
        if release && let Some(f) = inner.folders.remove(&folder) {
            f.forwarder.abort();
            if let Some(w) = f._watcher {
                w.stop();
            }
        }
    }

    /// The window to show `target` in, and what that window opened: the one opened on
    /// exactly that file or folder, else the nearest folder window holding it.
    pub fn find_for(&self, target: &Path) -> Option<(String, PathBuf)> {
        // Resolve `..` by hand: the path may not exist, so it can't be canonicalized.
        let mut clean = PathBuf::new();
        for c in target.components() {
            match c {
                std::path::Component::ParentDir => {
                    clean.pop();
                }
                std::path::Component::CurDir => {}
                c => clean.push(c),
            }
        }
        let target = clean.as_path();
        let inner = self.lock();
        let mut best: Option<(&String, &PathBuf)> = None;
        for (label, (opened, _)) in &inner.windows {
            if opened == target {
                return Some((label.clone(), opened.clone()));
            }
            let holds = opened.is_dir() && target.starts_with(opened);
            let nearer =
                best.is_none_or(|(_, b)| opened.components().count() > b.components().count());
            if holds && nearer {
                best = Some((label, opened));
            }
        }
        best.map(|(l, o)| (l.clone(), o.clone()))
    }

    /// What window `label` opened: a folder, or a file.
    pub fn opened(&self, label: &str) -> Option<PathBuf> {
        self.lock().windows.get(label).map(|(p, _)| p.clone())
    }

    pub fn window_count(&self) -> usize {
        self.lock().windows.len()
    }
}
