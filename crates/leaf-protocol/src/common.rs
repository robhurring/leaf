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
}

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
        }
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
