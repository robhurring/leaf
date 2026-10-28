//! Reader preferences kept on disk so they survive windows, ports, and
//! relaunches. One JSON file; patches merge; unknown or invalid fields are
//! dropped field by field, never the whole file.
use std::path::PathBuf;

use leaf_protocol::Preferences;
use tokio::sync::Mutex;

pub struct PreferencesStore {
    file: PathBuf,
    /// Serializes saves so two patches cannot interleave their read-merge-write.
    lock: Mutex<()>,
}

/// Keeps the known, valid fields of an untrusted object; drops the rest.
fn sanitize(value: &serde_json::Value) -> Preferences {
    let Some(obj) = value.as_object() else {
        return Preferences::default();
    };
    let field = |name: &str| -> serde_json::Value {
        obj.get(name).cloned().unwrap_or(serde_json::Value::Null)
    };
    let pick = |name: &str| -> serde_json::Value {
        let single = serde_json::json!({ name: field(name) });
        match serde_json::from_value::<Preferences>(single) {
            Ok(_) => field(name),
            Err(_) => serde_json::Value::Null,
        }
    };
    let cleaned = serde_json::json!({
        "theme": pick("theme"),
        "appearance": pick("appearance"),
        "treeOpen": pick("treeOpen"),
        "outlineOpen": pick("outlineOpen"),
        "numbering": pick("numbering"),
        "textPct": pick("textPct"),
        "treeWidth": pick("treeWidth"),
        "outlineWidth": pick("outlineWidth"),
    });
    in_range(serde_json::from_value(cleaned).unwrap_or_default())
}

/// Sidebar widths in CSS pixels.
const SIDEBAR_MIN: u32 = 160;
const SIDEBAR_MAX: u32 = 480;

/// The schema's ranges: text size 50..=200 percent, sidebars 160..=480 px. Out of range is dropped, not clamped.
fn in_range(mut p: Preferences) -> Preferences {
    if p.text_pct.is_some_and(|t| !(50..=200).contains(&t)) {
        p.text_pct = None;
    }
    for w in [&mut p.tree_width, &mut p.outline_width] {
        if w.is_some_and(|w| !(SIDEBAR_MIN..=SIDEBAR_MAX).contains(&w)) {
            *w = None;
        }
    }
    p
}

impl PreferencesStore {
    pub fn new(file: PathBuf) -> PreferencesStore {
        PreferencesStore {
            file,
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &std::path::Path {
        &self.file
    }

    async fn read(&self) -> Preferences {
        let Ok(text) = tokio::fs::read_to_string(&self.file).await else {
            return Preferences::default();
        };
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(v) => sanitize(&v),
            Err(e) => {
                tracing::warn!(file = %self.file.display(), error = %e, "preferences file invalid; starting empty");
                Preferences::default()
            }
        }
    }

    pub async fn load(&self) -> Preferences {
        self.read().await
    }

    /// Merges `patch` into the stored preferences and returns the result.
    pub async fn save(&self, patch: Preferences) -> Preferences {
        let _guard = self.lock.lock().await;
        let next = self.read().await.merged(&in_range(patch));
        if let Some(dir) = self.file.parent() {
            let _ = tokio::fs::create_dir_all(dir).await;
        }
        let tmp = self
            .file
            .with_extension(format!("{}.tmp", std::process::id()));
        let text = serde_json::to_string_pretty(&next).unwrap_or_else(|_| "{}".into()) + "\n";
        match tokio::fs::write(&tmp, text).await {
            Ok(()) => {
                if let Err(e) = tokio::fs::rename(&tmp, &self.file).await {
                    tracing::warn!(file = %self.file.display(), error = %e, "could not save preferences");
                    let _ = tokio::fs::remove_file(&tmp).await;
                }
            }
            Err(e) => {
                tracing::warn!(file = %self.file.display(), error = %e, "could not save preferences")
            }
        }
        tracing::debug!(file = %self.file.display(), "preferences saved");
        next
    }
}
