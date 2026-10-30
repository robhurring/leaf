use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_children: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub kind: EntryKind,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub watch: bool,
    pub write: bool,
    pub collaborate: bool,
    /// The server also serves file bytes at `/raw/<path>` over HTTP.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_urls: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plantuml_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_entries: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    OutsideRoot,
    Unsupported,
    BadRequest,
    Internal,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub commit: String,
    pub author: String,
    /// Unix seconds, as `git log --format=%at` reports it.
    pub date: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_url: Option<String>,
}

/// Consecutive lines last changed by the same commit (`git blame`, grouped).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// 1-based first line.
    pub start: u32,
    pub lines: u32,
    pub commit: String,
    pub author: String,
    /// Unix milliseconds of the commit's author date.
    pub date: i64,
    pub summary: String,
    /// Changed in the working tree and not committed yet (no commit, author, or date).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub uncommitted: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Github,
    Glass,
    Card,
    Paper,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    Light,
    Dark,
    Auto,
}

/// Reader settings the server keeps across launches. Every field optional: a patch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<Appearance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_open: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub numbering: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_pct: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tree_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline_width: Option<u32>,
    /// The kinds of link (URL schemes) the app window hands to other apps;
    /// DEFAULT_LINK_SCHEMES when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_schemes: Option<Vec<String>>,
    /// Where the app opens a file or folder: a new window (the default) or a new tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_in: Option<OpenIn>,
    /// Reopen the windows and tabs that were open when the app quit; off by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopen_tabs: Option<bool>,
}

/// Where the app opens a file or folder it is asked to open.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OpenIn {
    /// A new tab in the front window.
    Tab,
    /// A window of its own.
    Window,
}

/// The link kinds the app window opens until the person changes the list: the web,
/// mail, and the editors people jump to code in.
pub const DEFAULT_LINK_SCHEMES: &[&str] = &[
    "https",
    "http",
    "mailto",
    "vscode",
    "vscode-insiders",
    "cursor",
    "windsurf",
    "zed",
];

impl Preferences {
    /// `self` with every field set in `patch` replaced.
    pub fn merged(&self, patch: &Preferences) -> Preferences {
        Preferences {
            theme: patch.theme.or(self.theme),
            appearance: patch.appearance.or(self.appearance),
            tree_open: patch.tree_open.or(self.tree_open),
            outline_open: patch.outline_open.or(self.outline_open),
            numbering: patch.numbering.or(self.numbering),
            text_pct: patch.text_pct.or(self.text_pct),
            tree_width: patch.tree_width.or(self.tree_width),
            outline_width: patch.outline_width.or(self.outline_width),
            link_schemes: patch
                .link_schemes
                .clone()
                .or_else(|| self.link_schemes.clone()),
            open_in: patch.open_in.or(self.open_in),
            reopen_tabs: patch.reopen_tabs.or(self.reopen_tabs),
        }
    }

    pub fn open_in_or_default(&self) -> OpenIn {
        self.open_in.unwrap_or(OpenIn::Window)
    }

    pub fn reopen_tabs_or_default(&self) -> bool {
        self.reopen_tabs.unwrap_or(false)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Base64,
    None,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    Created,
    Modified,
    Deleted,
    Renamed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merged_keeps_open_in_and_reopen_tabs() {
        let base = Preferences {
            open_in: Some(OpenIn::Window),
            reopen_tabs: Some(true),
            ..Default::default()
        };
        let patch = Preferences {
            open_in: Some(OpenIn::Tab),
            ..Default::default()
        };
        let m = base.merged(&patch);
        assert_eq!(m.open_in, Some(OpenIn::Tab));
        assert_eq!(m.reopen_tabs, Some(true));
        assert_eq!(base.merged(&Preferences::default()), base);
    }

    #[test]
    fn open_in_defaults_to_window_and_tabs_do_not_reopen() {
        let p = Preferences::default();
        assert_eq!(p.open_in_or_default(), OpenIn::Window);
        assert!(!p.reopen_tabs_or_default());
        let json = serde_json::to_value(Preferences {
            open_in: Some(OpenIn::Tab),
            reopen_tabs: Some(false),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "openIn": "tab", "reopenTabs": false })
        );
    }
}
