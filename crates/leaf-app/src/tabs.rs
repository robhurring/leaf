//! Windows of tabs, as data: which window holds which tabs, in what order, which one is
//! showing, and what each tab is (its workspace). No Tauri in here; the app applies
//! these changes to its webviews.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// What a tab is: a workspace on one or more roots (files or folders). Sharing will
/// hang off this record, so it outlives a tab moving between windows.
#[derive(Clone, Debug, PartialEq)]
pub struct Workspace {
    /// The tab's id, which is also its webview's label.
    pub id: String,
    pub roots: Vec<PathBuf>,
    /// The document a cloned tab opened on, relative to its root.
    pub opened_at: Option<String>,
}

#[derive(Default)]
pub struct Tabs {
    /// window → (its tabs in order, the active one)
    windows: HashMap<String, (Vec<String>, String)>,
    tabs: HashMap<String, Workspace>,
}

impl Tabs {
    pub fn new() -> Tabs {
        Tabs::default()
    }

    pub fn add_window(&mut self, window: &str) {
        self.windows
            .entry(window.to_string())
            .or_insert_with(|| (Vec::new(), String::new()));
    }

    /// Adds `ws` to `window` at `at` (the end when `None`), and makes it the active tab.
    pub fn add_tab(&mut self, window: &str, ws: Workspace, at: Option<usize>) {
        let id = ws.id.clone();
        self.tabs.insert(id.clone(), ws);
        self.insert(window, id, at);
    }

    fn insert(&mut self, window: &str, id: String, at: Option<usize>) {
        let (order, active) = self
            .windows
            .entry(window.to_string())
            .or_insert_with(|| (Vec::new(), String::new()));
        let at = at.unwrap_or(order.len()).min(order.len());
        order.insert(at, id.clone());
        *active = id;
    }

    /// Takes `tab` out of its window, activating its right neighbour (else its left);
    /// a window left empty is removed. Returns the window it was in.
    fn detach(&mut self, tab: &str) -> Option<(String, usize)> {
        let window = self.window_of(tab)?;
        let (order, active) = self.windows.get_mut(&window)?;
        let i = order.iter().position(|t| t == tab)?;
        order.remove(i);
        if order.is_empty() {
            self.windows.remove(&window);
        } else if active == tab {
            *active = order[i.min(order.len() - 1)].clone();
        }
        Some((window, i))
    }

    /// Closes `tab`; returns the window it was in. A window's last tab takes the window.
    pub fn close_tab(&mut self, tab: &str) -> Option<String> {
        let (window, _) = self.detach(tab)?;
        self.tabs.remove(tab);
        Some(window)
    }

    pub fn select(&mut self, tab: &str) {
        if let Some(w) = self.window_of(tab)
            && let Some((_, active)) = self.windows.get_mut(&w)
        {
            *active = tab.to_string();
        }
    }

    /// The tab `by` places from the active one, wrapping around.
    pub fn step(&self, window: &str, by: isize) -> Option<String> {
        let (order, active) = self.windows.get(window)?;
        let i = order.iter().position(|t| t == active)? as isize;
        let n = order.len() as isize;
        Some(order[(i + by).rem_euclid(n) as usize].clone())
    }

    /// The tab at position `n` (from 1); 9 is always the last, as in browsers.
    pub fn nth(&self, window: &str, n: usize) -> Option<String> {
        let (order, _) = self.windows.get(window)?;
        if n == 9 {
            return order.last().cloned();
        }
        order.get(n.checked_sub(1)?).cloned()
    }

    /// Moves `tab` into window `to` at `at` (the end when `None`; within its own window,
    /// `at` counts positions before the move) and makes it active there. Returns the
    /// window it left when that window was left empty and removed.
    pub fn move_tab(&mut self, tab: &str, to: &str, at: Option<usize>) -> Option<String> {
        let (from, i) = self.detach(tab)?;
        let at = match at {
            Some(a) if from == to && a > i => Some(a - 1),
            a => a,
        };
        let emptied = (from != to && !self.windows.contains_key(&from)).then_some(from);
        self.insert(to, tab.to_string(), at);
        emptied
    }

    pub fn window_of(&self, tab: &str) -> Option<String> {
        self.windows
            .iter()
            .find(|(_, (order, _))| order.iter().any(|t| t == tab))
            .map(|(w, _)| w.clone())
    }

    pub fn tabs_of(&self, window: &str) -> Vec<String> {
        self.windows
            .get(window)
            .map(|(o, _)| o.clone())
            .unwrap_or_default()
    }

    pub fn active(&self, window: &str) -> Option<String> {
        self.windows
            .get(window)
            .map(|(_, a)| a.clone())
            .filter(|a| !a.is_empty())
    }

    pub fn workspace(&self, tab: &str) -> Option<&Workspace> {
        self.tabs.get(tab)
    }

    /// The tab to show `target` in: one whose root is exactly it, else the one whose
    /// folder root holds it most nearly.
    pub fn covering(&self, target: &Path) -> Option<String> {
        let mut best: Option<(&String, usize)> = None;
        for (id, ws) in &self.tabs {
            for root in &ws.roots {
                if root == target {
                    return Some(id.clone());
                }
                let depth = root.components().count();
                let holds = target.starts_with(root) && !is_file_root(root, target);
                if holds && best.is_none_or(|(_, d)| depth > d) {
                    best = Some((id, depth));
                }
            }
        }
        best.map(|(id, _)| id.clone())
    }

    pub fn is_empty(&self) -> bool {
        self.windows.is_empty()
    }

    pub fn windows(&self) -> Vec<String> {
        let mut w: Vec<String> = self.windows.keys().cloned().collect();
        w.sort();
        w
    }
}

/// A root that is a file holds nothing but itself. Judged by the path when the file
/// doesn't exist (tests, deleted files): a name with an extension is a file.
fn is_file_root(root: &Path, target: &Path) -> bool {
    root != target && (root.is_file() || (!root.is_dir() && root.extension().is_some()))
}

/// A tab's name in the tab row: its root under `~`, plus the document a clone opened on.
pub fn label(ws: &Workspace, home: &Path) -> String {
    let Some(root) = ws.roots.first() else {
        return String::new();
    };
    let mut out = match root.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => root.display().to_string(),
    };
    if let Some(doc) = &ws.opened_at {
        let name = doc.rsplit('/').next().unwrap_or(doc);
        out.push_str(&format!(" › {name}"));
    }
    out
}

/// The Window menu's list of a window's tabs, given as (id, label): each item's id,
/// text, and key. ⌘1…⌘8 go to the first eight; ⌘9 to the last, as in browsers.
pub fn tab_menu_items(tabs: &[(String, String)]) -> Vec<(String, String, Option<String>)> {
    let last = tabs.len().saturating_sub(1);
    tabs.iter()
        .enumerate()
        .map(|(i, (id, label))| {
            let key = match i {
                0..=7 => Some(format!("CmdOrCtrl+{}", i + 1)),
                _ if i == last => Some("CmdOrCtrl+9".to_string()),
                _ => None,
            };
            (format!("tab:select:{id}"), label.clone(), key)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ws(id: &str, root: &str) -> Workspace {
        Workspace {
            id: id.into(),
            roots: vec![PathBuf::from(root)],
            opened_at: None,
        }
    }

    fn three() -> Tabs {
        let mut t = Tabs::new();
        t.add_window("w");
        for id in ["a", "b", "c"] {
            t.add_tab("w", ws(id, &format!("/{id}")), None);
        }
        t
    }

    #[test]
    fn close_activates_right_then_left() {
        let mut t = three();
        t.select("b");
        assert_eq!(t.close_tab("b"), Some("w".into()));
        assert_eq!(t.active("w").as_deref(), Some("c"));
        t.close_tab("c");
        assert_eq!(t.active("w").as_deref(), Some("a"));
        assert_eq!(t.tabs_of("w"), vec!["a"]);
    }

    #[test]
    fn closing_last_tab_removes_window() {
        let mut t = Tabs::new();
        t.add_window("w");
        t.add_tab("w", ws("a", "/a"), None);
        assert_eq!(t.close_tab("a"), Some("w".into()));
        assert!(t.windows().is_empty());
        assert!(t.is_empty());
        assert_eq!(t.workspace("a"), None);
    }

    #[test]
    fn step_wraps() {
        let mut t = three();
        t.select("a");
        assert_eq!(t.step("w", -1).as_deref(), Some("c"));
        t.select("c");
        assert_eq!(t.step("w", 1).as_deref(), Some("a"));
        assert_eq!(t.step("w", 1).as_deref(), Some("a"));
        assert_eq!(t.step("nope", 1), None);
    }

    #[test]
    fn nth_nine_is_last() {
        let mut t = three();
        t.add_tab("w", ws("d", "/d"), None);
        assert_eq!(t.nth("w", 9).as_deref(), Some("d"));
        assert_eq!(t.nth("w", 1).as_deref(), Some("a"));
        assert_eq!(t.nth("w", 6), None);
    }

    #[test]
    fn added_tab_is_active_and_lands_where_asked() {
        let mut t = three();
        assert_eq!(t.active("w").as_deref(), Some("c"));
        t.add_tab("w", ws("x", "/x"), Some(1));
        assert_eq!(t.tabs_of("w"), vec!["a", "x", "b", "c"]);
        assert_eq!(t.active("w").as_deref(), Some("x"));
        assert_eq!(t.window_of("x").as_deref(), Some("w"));
    }

    #[test]
    fn move_tab_to_other_window_at_index() {
        let mut t = three();
        t.add_window("w2");
        t.add_tab("w2", ws("z", "/z"), None);
        assert_eq!(t.move_tab("b", "w2", Some(0)), None);
        assert_eq!(t.tabs_of("w2"), vec!["b", "z"]);
        assert_eq!(t.active("w2").as_deref(), Some("b"));
        assert_eq!(t.window_of("b").as_deref(), Some("w2"));
        assert_eq!(t.tabs_of("w"), vec!["a", "c"]);
        // The only tab of w2... moved away empties w2, which goes.
        t.move_tab("z", "w", None);
        assert_eq!(t.move_tab("b", "w", None), Some("w2".into()));
        assert_eq!(t.windows(), vec!["w"]);
        assert_eq!(t.tabs_of("w"), vec!["a", "c", "z", "b"]);
    }

    #[test]
    fn move_within_a_window_reorders() {
        let mut t = three();
        assert_eq!(t.move_tab("c", "w", Some(0)), None);
        assert_eq!(t.tabs_of("w"), vec!["c", "a", "b"]);
        t.move_tab("c", "w", Some(3));
        assert_eq!(t.tabs_of("w"), vec!["a", "b", "c"]);
    }

    #[test]
    fn covering_prefers_nearest_root() {
        let mut t = Tabs::new();
        t.add_window("w");
        t.add_tab("w", ws("top", "/a"), None);
        t.add_tab("w", ws("deep", "/a/b"), None);
        t.add_tab("w", ws("file", "/a/f.md"), None);
        assert_eq!(t.covering(Path::new("/a/b/c.md")).as_deref(), Some("deep"));
        assert_eq!(t.covering(Path::new("/a/x.md")).as_deref(), Some("top"));
        assert_eq!(t.covering(Path::new("/a/f.md")).as_deref(), Some("file"));
        assert_eq!(t.covering(Path::new("/z.md")), None);
        // A file root covers only itself.
        assert_eq!(t.covering(Path::new("/a/f.md/x")).as_deref(), Some("top"));
    }

    #[test]
    fn label_uses_tilde_and_clone_suffix() {
        let home = Path::new("/Users/r");
        assert_eq!(label(&ws("a", "/Users/r/code/docs"), home), "~/code/docs");
        let clone = Workspace {
            opened_at: Some("guide/intro.md".into()),
            ..ws("b", "/Users/r/code/docs")
        };
        assert_eq!(label(&clone, home), "~/code/docs › intro.md");
        assert_eq!(label(&ws("c", "/opt/x"), home), "/opt/x");
        assert_eq!(label(&ws("d", "/Users/rob"), home), "/Users/rob");
        assert_eq!(label(&ws("e", "/Users/r"), home), "~");
    }

    #[test]
    fn menu_items_for_tabs() {
        let tabs: Vec<(String, String)> = (1..=10)
            .map(|i| (format!("t{i}"), format!("~/p{i}")))
            .collect();
        let items = tab_menu_items(&tabs);
        assert_eq!(items.len(), 10);
        assert_eq!(
            items[0],
            (
                "tab:select:t1".into(),
                "~/p1".into(),
                Some("CmdOrCtrl+1".into())
            )
        );
        assert_eq!(items[7].2.as_deref(), Some("CmdOrCtrl+8"));
        assert_eq!(items[8].2, None);
        assert_eq!(items[9].2.as_deref(), Some("CmdOrCtrl+9"));
        let two = tab_menu_items(&tabs[..2]);
        assert_eq!(two[1].2.as_deref(), Some("CmdOrCtrl+2"));
    }
}
