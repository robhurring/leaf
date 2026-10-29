//! Where windows go: each file or folder's window reopens where it last was, a new one
//! takes the last window's size, windows step aside rather than stack exactly, and
//! nothing opens off-screen. Logical pixels throughout; no Tauri in here.
use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A window's outer position and inner size, in logical pixels.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A screen's usable area, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

/// How far a window steps down and right when its spot is taken (as macOS does).
const STEP: f64 = 28.0;
/// Two windows this close are in the same spot.
const SAME: f64 = 4.0;

#[derive(Serialize, Deserialize, Default, Debug)]
pub struct WindowStates {
    #[serde(default)]
    by_path: HashMap<String, Geometry>,
    #[serde(default)]
    last: Option<Geometry>,
}

impl WindowStates {
    /// The saved states, or none when the file is missing or unreadable.
    pub fn load(file: &Path) -> WindowStates {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Writes the states, replacing the file in one step.
    pub fn save(&self, file: &Path) -> std::io::Result<()> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(tmp, file)
    }

    /// Remembers where `path`'s window is now; it's also the size new windows take.
    pub fn record(&mut self, path: &Path, g: Geometry) {
        self.by_path.insert(path.to_string_lossy().into_owned(), g);
        self.last = Some(g);
    }

    /// Where a window on `path` opens, given the windows already open and the screens;
    /// None when nothing is known (the default placement).
    pub fn place(&self, path: &Path, open: &[Geometry], screens: &[Rect]) -> Option<Geometry> {
        let mut g = self
            .by_path
            .get(path.to_string_lossy().as_ref())
            .or(self.last.as_ref())
            .copied()?;
        while open
            .iter()
            .any(|o| (o.x - g.x).abs() < SAME && (o.y - g.y).abs() < SAME)
        {
            g.x += STEP;
            g.y += STEP;
        }
        Some(fit(g, screens))
    }
}

/// Keeps a window on a screen: the one under its title bar, else the first, centered.
fn fit(mut g: Geometry, screens: &[Rect]) -> Geometry {
    let Some(first) = screens.first() else {
        return g;
    };
    let (screen, centered) = match screens.iter().find(|s| s.contains(g.x + 40.0, g.y + 10.0)) {
        Some(s) => (s, false),
        None => (first, true),
    };
    g.width = g.width.min(screen.width);
    g.height = g.height.min(screen.height);
    if centered {
        g.x = screen.x + (screen.width - g.width) / 2.0;
        g.y = screen.y + (screen.height - g.height) / 2.0;
    } else {
        // Stepping or a smaller screen may push it past an edge: pull it back in.
        g.x = g.x.clamp(screen.x, screen.x + screen.width - g.width);
        g.y = g.y.clamp(screen.y, screen.y + screen.height - g.height);
    }
    g
}
