//! The windows and tabs open when the app quit, for "Reopen my tabs when leaf starts":
//! saved to `<config-dir>/tabs.json` on quit, read back on start.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::window_state::Geometry;

#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
pub struct Saved {
    pub windows: Vec<SavedWindow>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct SavedWindow {
    pub place: Option<Geometry>,
    /// Which tab was showing, by position.
    pub active: usize,
    pub tabs: Vec<SavedTab>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct SavedTab {
    pub roots: Vec<PathBuf>,
    /// The document it showed, relative to its root.
    pub doc: Option<String>,
}

/// Writes `s` to `path`, whole or not at all.
pub fn save(path: &Path, s: &Saved) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(s)? + "\n")?;
    std::fs::rename(&tmp, path)
}

/// What was saved; nothing when the file is missing or unreadable.
pub fn load(path: &Path) -> Saved {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// `s` without the tabs whose file or folder is gone, and without windows left empty;
/// each window's showing tab stays in range.
pub fn restorable(s: Saved) -> Saved {
    let windows = s
        .windows
        .into_iter()
        .filter_map(|w| {
            let tabs: Vec<SavedTab> = w
                .tabs
                .into_iter()
                .filter(|t| t.roots.first().is_some_and(|r| r.exists()))
                .collect();
            if tabs.is_empty() {
                return None;
            }
            Some(SavedWindow {
                active: w.active.min(tabs.len() - 1),
                tabs,
                ..w
            })
        })
        .collect();
    Saved { windows }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tab(root: &Path) -> SavedTab {
        SavedTab {
            roots: vec![root.to_path_buf()],
            doc: Some("a.md".into()),
        }
    }

    #[test]
    fn roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let s = Saved {
            windows: vec![SavedWindow {
                place: Some(Geometry {
                    x: 1.0,
                    y: 2.0,
                    width: 800.0,
                    height: 600.0,
                    maximized: false,
                }),
                active: 0,
                tabs: vec![tab(d.path())],
            }],
        };
        let file = d.path().join("tabs.json");
        save(&file, &s).unwrap();
        assert_eq!(load(&file), s);
    }

    #[test]
    fn restore_drops_missing_roots() {
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("gone");
        let s = Saved {
            windows: vec![SavedWindow {
                place: None,
                active: 1,
                tabs: vec![tab(d.path()), tab(&gone)],
            }],
        };
        let r = restorable(s);
        assert_eq!(r.windows.len(), 1);
        assert_eq!(r.windows[0].tabs, vec![tab(d.path())]);
        assert_eq!(r.windows[0].active, 0);
    }

    #[test]
    fn empty_window_is_dropped() {
        let d = tempfile::tempdir().unwrap();
        let s = Saved {
            windows: vec![
                SavedWindow {
                    place: None,
                    active: 0,
                    tabs: vec![tab(&d.path().join("nope"))],
                },
                SavedWindow {
                    place: None,
                    active: 0,
                    tabs: vec![tab(d.path())],
                },
            ],
        };
        assert_eq!(restorable(s).windows.len(), 1);
    }

    #[test]
    fn restore_ignores_corrupt_or_missing_file() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("tabs.json");
        assert_eq!(load(&file), Saved::default());
        std::fs::write(&file, "{not json").unwrap();
        assert_eq!(load(&file), Saved::default());
    }
}
