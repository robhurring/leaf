//! The seam between "where bytes come from" and everything else. `DiskSource`
//! is the implementation today; a remote source later implements the same thing.
use std::fmt;

use async_trait::async_trait;
use leaf_protocol::{
    BlameHunk, Capabilities, Encoding, Entry, ErrorCode, GitInfo, RootInfo, TextHit,
};

#[derive(Debug, Clone, PartialEq)]
pub struct FileData {
    pub path: String,
    pub kind: String,
    pub lang: Option<String>,
    pub mime: String,
    pub encoding: Encoding,
    pub content: Option<String>,
    pub size: u64,
    /// Unix milliseconds.
    pub mtime: f64,
    /// Unix milliseconds the file was created, where the filesystem records it.
    pub created: Option<f64>,
    pub git: Option<GitInfo>,
}

/// Who last changed each line of a file, from git.
#[derive(Debug, Clone, PartialEq)]
pub struct Blame {
    pub hunks: Vec<BlameHunk>,
    /// The repository's web page, for linking commits.
    pub repo_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceError {
    pub code: ErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl SourceError {
    pub fn new(code: ErrorCode, message: impl Into<String>, path: Option<&str>) -> SourceError {
        SourceError {
            code,
            message: message.into(),
            path: path.map(str::to_string),
        }
    }
}
impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for SourceError {}

#[async_trait]
pub trait Source: Send + Sync {
    fn root(&self) -> RootInfo;
    fn capabilities(&self) -> Capabilities;
    async fn list(&self, path: &str) -> Result<Vec<Entry>, SourceError>;
    async fn read(&self, path: &str) -> Result<FileData, SourceError>;
    async fn search(&self, q: &str, limit: usize) -> Result<Vec<Entry>, SourceError>;
    /// Lines containing `q` (case-insensitive) across the source's text files.
    async fn search_text(&self, _q: &str, _limit: usize) -> Result<Vec<TextHit>, SourceError> {
        Ok(Vec::new())
    }
    /// Who last changed each line of `path`; None when the file isn't in git.
    async fn blame(&self, _path: &str) -> Result<Option<Blame>, SourceError> {
        Ok(None)
    }
    /// True when `path` is hidden by the source's ignore rules: a transport serving
    /// others (a shared tab) refuses it before asking. Sources without rules hide nothing.
    fn hides(&self, _path: &str) -> bool {
        false
    }
    /// The file on disk for `path`, when this source has one: confined, not ignored, a file.
    /// Lets a transport stream bytes without reading them through `read`.
    async fn locate(&self, path: &str) -> Result<std::path::PathBuf, SourceError> {
        Err(SourceError::new(
            ErrorCode::Unsupported,
            "no file path for this source",
            Some(path),
        ))
    }
}

/// Lines of `content` containing `needle` (already lowercase), at most `max` of them.
/// Long lines are cut to a window around the first match.
pub fn text_hits(path: &str, content: &str, needle: &str, max: usize) -> Vec<TextHit> {
    const WIDTH: usize = 200;
    let mut out = Vec::new();
    if needle.is_empty() {
        return out;
    }
    for (i, raw) in content.lines().enumerate() {
        if out.len() >= max {
            break;
        }
        let line = raw.trim();
        let lower = line.to_lowercase();
        let Some(at) = lower.find(needle) else {
            continue;
        };
        let text = if line.chars().count() <= WIDTH {
            line.to_string()
        } else {
            // Lowercasing can shift byte offsets; count characters before the match instead.
            let before = lower[..at].chars().count();
            let start = before.saturating_sub(60);
            let cut: String = line.chars().skip(start).take(WIDTH).collect();
            if start > 0 { format!("…{cut}") } else { cut }
        };
        out.push(TextHit {
            path: path.to_string(),
            line: (i + 1) as u32,
            text,
        });
    }
    out
}
