//! Turns raw filesystem events into protocol-shaped change events: debounced
//! per path, with a delete and a create that look like one move folded into
//! `renamed`, and an editor's temp-file-then-rename save reported as a plain
//! `modified` on the real path.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use leaf_protocol::Change;
use notify::{EventKind, RecursiveMode, Watcher as _};
use tokio::sync::{broadcast, mpsc};

use crate::ignore::Ignorer;

pub const DEBOUNCE_MS: u64 = 60;
/// A create or delete may be half of a rename; the partner can trail by ~100 ms.
pub const RENAME_WINDOW_MS: u64 = 200;
pub const MAX_HOLD_MS: u64 = 500;
pub const SETTLE_MS: u64 = 50;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeEvent {
    pub path: String,
    pub change: Change,
    pub from: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Raw {
    Created,
    Modified,
    Deleted,
}

#[derive(Debug)]
pub struct WatchError(pub String);
impl std::fmt::Display for WatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for WatchError {}

pub struct Watcher {
    _inner: notify::RecommendedWatcher,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

fn basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}
fn dirname(p: &str) -> &str {
    p.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

/// Files editors write beside the real one and rename over it.
fn looks_temporary(path: &str) -> bool {
    let name = basename(path);
    name.starts_with('.')
        || name.ends_with('~')
        || name.ends_with(".tmp")
        || name.ends_with(".swp")
        || name.ends_with(".bak")
        || name.chars().all(|c| c.is_ascii_digit())
}

/// Pairs deletes with creates in one batch into renames; the rest pass through.
fn fold(batch: Vec<(String, Raw)>) -> Vec<ChangeEvent> {
    let deleted: Vec<String> = batch
        .iter()
        .filter(|(_, c)| *c == Raw::Deleted)
        .map(|(p, _)| p.clone())
        .collect();
    let created: Vec<String> = batch
        .iter()
        .filter(|(_, c)| *c == Raw::Created)
        .map(|(p, _)| p.clone())
        .collect();
    let mut taken: Vec<String> = Vec::new();
    let mut out: Vec<ChangeEvent> = Vec::new();
    let pair = |from: &str, to: &str, taken: &mut Vec<String>, out: &mut Vec<ChangeEvent>| {
        taken.push(from.to_string());
        taken.push(to.to_string());
        if looks_temporary(from) {
            // A safe-write save: the real file changed, nothing was renamed from the reader's view.
            out.push(ChangeEvent {
                path: to.to_string(),
                change: Change::Modified,
                from: None,
            });
        } else {
            out.push(ChangeEvent {
                path: to.to_string(),
                change: Change::Renamed,
                from: Some(from.to_string()),
            });
        }
    };
    // A move keeps the basename; a rename in place keeps the directory. Pair only when unambiguous.
    for from in &deleted {
        let same: Vec<&String> = created
            .iter()
            .filter(|to| !taken.contains(to) && basename(to) == basename(from))
            .collect();
        if same.len() == 1 {
            pair(from, same[0], &mut taken, &mut out);
        }
    }
    for from in &deleted {
        if taken.contains(from) {
            continue;
        }
        let dir = dirname(from);
        let sd: Vec<&String> = deleted
            .iter()
            .filter(|p| !taken.contains(p) && dirname(p) == dir)
            .collect();
        let sc: Vec<&String> = created
            .iter()
            .filter(|p| !taken.contains(p) && dirname(p) == dir)
            .collect();
        if sd.len() == 1 && sc.len() == 1 {
            pair(from, sc[0], &mut taken, &mut out);
        }
    }
    for (path, change) in batch {
        if taken.contains(&path) {
            continue;
        }
        let change = match change {
            Raw::Created => Change::Created,
            Raw::Modified => Change::Modified,
            Raw::Deleted => Change::Deleted,
        };
        out.push(ChangeEvent {
            path,
            change,
            from: None,
        });
    }
    out
}

impl Watcher {
    /// Watches `root` recursively and sends folded events on `tx`. Events for ignored
    /// paths are dropped. `root` should be canonical: the OS reports real paths.
    pub fn start(
        root: PathBuf,
        ignorer: Arc<Ignorer>,
        tx: broadcast::Sender<ChangeEvent>,
    ) -> Result<Watcher, WatchError> {
        let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<(PathBuf, EventKind)>();
        let mut inner = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                for p in ev.paths {
                    let _ = raw_tx.send((p, ev.kind));
                }
            }
        })
        .map_err(|e| WatchError(e.to_string()))?;
        inner
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| WatchError(e.to_string()))?;
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
        let started = std::time::SystemTime::now();

        tokio::spawn(async move {
            let mut pending: HashMap<String, Raw> = HashMap::new();
            let mut order: Vec<String> = Vec::new();
            let mut first_at: Option<Instant> = None;
            let mut deadline: Option<Instant> = None;
            loop {
                let sleep = async {
                    match deadline {
                        Some(d) => {
                            tokio::time::sleep_until(tokio::time::Instant::from_std(d)).await
                        }
                        None => std::future::pending::<()>().await,
                    }
                };
                tokio::select! {
                    _ = &mut stop_rx => break,
                    raw = raw_rx.recv() => {
                        let Some((abs, kind)) = raw else { break };
                        let Some(rel) = rel_of(&root, &abs) else { continue };
                        if rel.is_empty() {
                            continue;
                        }
                        let Some(change) = classify_event(kind, &abs, started) else { continue };
                        // A deleted path cannot say whether it was a folder; a folder-only rule
                        // (`build/`) must still hide it, so ask both ways.
                        let ignored = if abs.exists() {
                            ignorer.ignores(&rel, abs.is_dir())
                        } else {
                            ignorer.ignores(&rel, false) || ignorer.ignores(&rel, true)
                        };
                        if ignored {
                            continue;
                        }
                        let now = Instant::now();
                        if pending.is_empty() {
                            first_at = Some(now);
                        }
                        if !pending.contains_key(&rel) {
                            order.push(rel.clone());
                        }
                        // A create after a modify is still a create; a delete wins over both.
                        let merged = match (pending.get(&rel), change) {
                            (Some(Raw::Created), Raw::Modified) => Raw::Created,
                            (_, c) => c,
                        };
                        pending.insert(rel, merged);
                        let maybe_rename = pending.values().any(|c| *c != Raw::Modified);
                        let window = if maybe_rename { DEBOUNCE_MS.max(RENAME_WINDOW_MS) } else { DEBOUNCE_MS };
                        let max_end = first_at.unwrap_or(now) + Duration::from_millis(MAX_HOLD_MS);
                        let wanted = now + Duration::from_millis(window);
                        deadline = Some(wanted.min(max_end).max(now));
                    }
                    _ = sleep => {
                        deadline = None;
                        let batch: Vec<(String, Raw)> = order.drain(..).filter_map(|p| pending.remove(&p).map(|c| (p, c))).collect();
                        pending.clear();
                        for ev in fold(batch) {
                            let _ = tx.send(ev);
                        }
                    }
                }
            }
        });

        Ok(Watcher {
            _inner: inner,
            stop: Some(stop_tx),
        })
    }

    pub fn stop(mut self) {
        if let Some(s) = self.stop.take() {
            let _ = s.send(());
        }
    }
}

fn rel_of(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("/"))
}

/// What a raw event means for the path, settled by what is on disk now: a rename
/// arrives as a name change on both ends, and only the end that exists was created.
fn classify_event(kind: EventKind, abs: &Path, started: std::time::SystemTime) -> Option<Raw> {
    use notify::event::{ModifyKind, RenameMode};
    // macOS coalesces a file's history into one flag set, so a file created before we
    // started watching keeps reporting "created" on every write. Its birth time tells.
    let created_now = |abs: &Path| -> Raw {
        let born_before = std::fs::metadata(abs)
            .ok()
            .and_then(|m| m.created().ok())
            .map(|t| t < started)
            .unwrap_or(false);
        if born_before {
            Raw::Modified
        } else {
            Raw::Created
        }
    };
    match kind {
        EventKind::Create(_) => Some(if abs.exists() {
            created_now(abs)
        } else {
            Raw::Deleted
        }),
        EventKind::Remove(_) => Some(Raw::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => Some(Raw::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => Some(Raw::Created),
        EventKind::Modify(ModifyKind::Name(_)) => Some(if abs.exists() {
            Raw::Created
        } else {
            Raw::Deleted
        }),
        EventKind::Modify(ModifyKind::Data(_)) | EventKind::Modify(ModifyKind::Any) => {
            Some(if abs.exists() {
                Raw::Modified
            } else {
                Raw::Deleted
            })
        }
        EventKind::Modify(ModifyKind::Metadata(_)) | EventKind::Modify(ModifyKind::Other) => None,
        EventKind::Any | EventKind::Other => Some(if abs.exists() {
            Raw::Modified
        } else {
            Raw::Deleted
        }),
        EventKind::Access(_) => None,
    }
}
