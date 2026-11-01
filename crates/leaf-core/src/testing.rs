//! In-memory fakes for tests: a `Source` over a map of path → text.
use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use leaf_protocol::{Capabilities, Encoding, Entry, EntryKind, ErrorCode, RootInfo};

use crate::classify::classify;
use crate::source::{FileData, Source, SourceError};

pub struct FakeSource {
    pub files: Mutex<BTreeMap<String, String>>,
    pub root_info: RootInfo,
}

impl FakeSource {
    pub fn new(files: &[(&str, &str)]) -> FakeSource {
        FakeSource {
            files: Mutex::new(
                files
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect(),
            ),
            root_info: RootInfo {
                kind: EntryKind::Dir,
                name: "fake".into(),
            },
        }
    }
}

#[async_trait]
impl Source for FakeSource {
    fn root(&self) -> RootInfo {
        self.root_info.clone()
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            watch: true,
            write: false,
            collaborate: false,
            raw_urls: None,
            raw_base: None,
        }
    }
    async fn list(&self, path: &str) -> Result<Vec<Entry>, SourceError> {
        if path.starts_with("..") {
            return Err(SourceError::new(
                ErrorCode::OutsideRoot,
                "outside",
                Some(path),
            ));
        }
        let prefix = if path.is_empty() {
            String::new()
        } else {
            format!("{path}/")
        };
        let files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        for (p, content) in files.iter() {
            let Some(rest) = p.strip_prefix(&prefix) else {
                continue;
            };
            let mut parts = rest.splitn(2, '/');
            let head = parts.next().unwrap_or("");
            if head.is_empty() || !seen.insert(head.to_string()) {
                continue;
            }
            if parts.next().is_some() {
                out.push(Entry {
                    path: format!("{prefix}{head}"),
                    name: head.into(),
                    kind: EntryKind::Dir,
                    size: None,
                    mtime: None,
                    has_children: Some(true),
                });
            } else {
                out.push(Entry {
                    path: p.clone(),
                    name: head.into(),
                    kind: EntryKind::File,
                    size: Some(content.len() as u64),
                    mtime: Some(1.0),
                    has_children: None,
                });
            }
        }
        Ok(out)
    }
    async fn read(&self, path: &str) -> Result<FileData, SourceError> {
        if path.starts_with("..") {
            return Err(SourceError::new(
                ErrorCode::OutsideRoot,
                "outside",
                Some(path),
            ));
        }
        let files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let content = files
            .get(path)
            .ok_or_else(|| SourceError::new(ErrorCode::NotFound, "missing", Some(path)))?;
        let c = classify(std::path::Path::new(path));
        Ok(FileData {
            path: path.into(),
            kind: if c.kind == "binary" {
                "text".into()
            } else {
                c.kind.into()
            },
            lang: c.lang.map(str::to_string),
            mime: c.mime,
            encoding: Encoding::Utf8,
            content: Some(content.clone()),
            size: content.len() as u64,
            mtime: 1.0,
            created: None,
            git: None,
        })
    }
    async fn search(&self, q: &str, limit: usize) -> Result<Vec<Entry>, SourceError> {
        let q = q.to_lowercase();
        Ok(self
            .list("")
            .await?
            .into_iter()
            .filter(|e| e.path.to_lowercase().contains(&q))
            .take(limit)
            .collect())
    }
    async fn search_text(
        &self,
        q: &str,
        limit: usize,
    ) -> Result<Vec<leaf_protocol::TextHit>, SourceError> {
        let needle = q.to_lowercase();
        let files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let mut paths: Vec<&String> = files.keys().collect();
        paths.sort();
        let mut out = Vec::new();
        for p in paths {
            out.extend(crate::source::text_hits(
                p,
                &files[p],
                &needle,
                limit - out.len(),
            ));
            if out.len() >= limit {
                break;
            }
        }
        Ok(out)
    }
}
