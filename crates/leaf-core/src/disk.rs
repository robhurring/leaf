//! Reads a file or folder from the local disk: the only module that touches the
//! filesystem on behalf of the protocol.
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use base64::Engine as _;
use leaf_protocol::{Capabilities, Encoding, Entry, EntryKind, ErrorCode, RootInfo, TextHit};

use crate::classify::{classify, looks_like_text};
use crate::git::GitInfoProvider;
use crate::ignore::Ignorer;
use crate::paths::resolve_inside;
use crate::source::{FileData, Source, SourceError, text_hits};

#[derive(Clone, Debug)]
pub struct DiskOptions {
    pub target: PathBuf,
    pub ignore: Vec<String>,
    pub gitignore: bool,
    pub max_entries: usize,
    pub max_inline_bytes: u64,
}

const INLINE_KINDS: &[&str] = &["markdown", "text"];

pub struct DiskSource {
    opts: DiskOptions,
    root_dir: PathBuf,
    root_kind: EntryKind,
    /// For a single-file target: its name; else empty.
    target_rel: String,
    ignorer: Ignorer,
    git: GitInfoProvider,
    /// The root through symlinks, for naming files by their real path.
    root_real: Option<PathBuf>,
}

fn name_of(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn join_rel(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn is_subsequence(needle: &str, hay: &str) -> bool {
    let mut n = needle.chars();
    let mut want = n.next();
    for c in hay.chars() {
        if Some(c) == want {
            want = n.next();
        }
    }
    want.is_none()
}

impl DiskSource {
    pub fn new(opts: DiskOptions) -> Result<DiskSource, SourceError> {
        let meta = std::fs::metadata(&opts.target).map_err(|_| {
            SourceError::new(
                ErrorCode::NotFound,
                format!("no such file or directory: {}", opts.target.display()),
                None,
            )
        })?;
        let (root_kind, root_dir, target_rel) = if meta.is_dir() {
            (EntryKind::Dir, opts.target.clone(), String::new())
        } else {
            let parent = opts
                .target
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("/"));
            let name = opts
                .target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            (EntryKind::File, parent, name)
        };
        let ignorer = Ignorer::new(&root_dir, &opts.ignore, opts.gitignore);
        let git = GitInfoProvider::new(&root_dir);
        let root_real = root_dir.canonicalize().ok();
        Ok(DiskSource {
            opts,
            root_real,
            root_dir,
            root_kind,
            target_rel,
            ignorer,
            git,
        })
    }

    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    /// Hidden by the ignore rules; a single-file target is never hidden from itself.
    pub fn is_ignored(&self, rel: &str, is_dir: bool) -> bool {
        if self.root_kind == EntryKind::File && rel == self.target_rel {
            return false;
        }
        self.ignorer.ignores(rel, is_dir)
    }

    /// The file's own path under the root, as the disk names it: on a case- or
    /// normalization-insensitive volume, or through an in-root symlink, the name asked
    /// for can differ from the one the ignore rules see. None when it doesn't exist.
    fn real_rel(&self, rel: &str) -> Option<String> {
        let root = self.root_real.as_ref()?;
        let real = resolve_inside(&self.root_dir, rel)
            .ok()?
            .canonicalize()
            .ok()?;
        let inside = real.strip_prefix(root).ok()?;
        let parts: Vec<String> = inside
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        Some(parts.join("/"))
    }

    /// Hidden by the ignore rules, under the name asked for or the file's real one.
    fn hidden(&self, rel: &str, is_dir: bool) -> bool {
        self.is_ignored(rel, is_dir)
            || self
                .real_rel(rel)
                .is_some_and(|real| real != rel && self.is_ignored(&real, is_dir))
    }

    fn resolve(&self, rel: &str) -> Result<PathBuf, SourceError> {
        resolve_inside(&self.root_dir, rel).map_err(|_| {
            SourceError::new(
                ErrorCode::OutsideRoot,
                format!("path escapes the root: {rel}"),
                Some(rel),
            )
        })
    }

    async fn has_children(&self, rel: &str, abs: &Path) -> bool {
        let Ok(mut rd) = tokio::fs::read_dir(abs).await else {
            return false;
        };
        while let Ok(Some(d)) = rd.next_entry().await {
            let name = d.file_name().to_string_lossy().into_owned();
            let is_dir = d.file_type().await.map(|t| t.is_dir()).unwrap_or(false);
            if !self.is_ignored(&join_rel(rel, &name), is_dir) {
                return true;
            }
        }
        false
    }

    async fn entry_for(&self, rel: &str, is_dir: bool) -> Result<Entry, SourceError> {
        let abs = self.root_dir.join(rel);
        if is_dir {
            return Ok(Entry {
                path: rel.to_string(),
                name: name_of(rel).to_string(),
                kind: EntryKind::Dir,
                size: None,
                mtime: None,
                has_children: Some(self.has_children(rel, &abs).await),
            });
        }
        let meta = tokio::fs::metadata(&abs).await.map_err(|_| {
            SourceError::new(
                ErrorCode::NotFound,
                format!("no such file: {rel}"),
                Some(rel),
            )
        })?;
        Ok(Entry {
            path: rel.to_string(),
            name: name_of(rel).to_string(),
            kind: EntryKind::File,
            size: Some(meta.len()),
            mtime: Some(mtime_ms(&meta)),
            has_children: None,
        })
    }

    /// Unknown extension: look at the first 8 KiB to decide text vs binary.
    async fn sniff_text(&self, abs: &Path) -> bool {
        use tokio::io::AsyncReadExt;
        let Ok(mut f) = tokio::fs::File::open(abs).await else {
            return false;
        };
        let mut buf = vec![0u8; 8192];
        let mut filled = 0;
        while filled < buf.len() {
            match f.read(&mut buf[filled..]).await {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(_) => return false,
            }
        }
        looks_like_text(&buf[..filled])
    }
}

#[async_trait]
impl Source for DiskSource {
    fn root(&self) -> RootInfo {
        RootInfo {
            kind: self.root_kind,
            name: self
                .opts
                .target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            watch: true,
            write: false,
            collaborate: false,
            raw_urls: Some(true),
            raw_base: None,
        }
    }

    async fn list(&self, path: &str) -> Result<Vec<Entry>, SourceError> {
        if self.root_kind == EntryKind::File && path.is_empty() {
            return Ok(vec![self.entry_for(&self.target_rel.clone(), false).await?]);
        }
        let abs = self.resolve(path)?;
        if self.hidden(path, true) {
            return Err(SourceError::new(
                ErrorCode::NotFound,
                format!("no such directory: {path}"),
                Some(path),
            ));
        }
        let mut rd = tokio::fs::read_dir(&abs).await.map_err(|_| {
            SourceError::new(
                ErrorCode::NotFound,
                format!("no such directory: {path}"),
                Some(path),
            )
        })?;
        let mut entries = Vec::new();
        while let Ok(Some(d)) = rd.next_entry().await {
            let name = d.file_name().to_string_lossy().into_owned();
            let rel = join_rel(path, &name);
            let Ok(ft) = d.file_type().await else {
                continue;
            };
            let is_dir = if ft.is_symlink() {
                // Follow links that stay inside the root; drop the rest.
                let Ok(target) = resolve_inside(&self.root_dir, &rel) else {
                    continue;
                };
                let Ok(meta) = tokio::fs::metadata(&target).await else {
                    continue;
                };
                if !meta.is_dir() && !meta.is_file() {
                    continue;
                }
                meta.is_dir()
            } else if ft.is_dir() {
                true
            } else if ft.is_file() {
                false
            } else {
                continue;
            };
            if self.hidden(&rel, is_dir) {
                continue;
            }
            entries.push(self.entry_for(&rel, is_dir).await?);
        }
        entries.sort_by(|a, b| match (a.kind, b.kind) {
            (EntryKind::Dir, EntryKind::File) => std::cmp::Ordering::Less,
            (EntryKind::File, EntryKind::Dir) => std::cmp::Ordering::Greater,
            _ => a
                .name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.name.cmp(&b.name)),
        });
        Ok(entries)
    }

    async fn read(&self, path: &str) -> Result<FileData, SourceError> {
        let abs = self.resolve(path)?;
        let not_found = || {
            SourceError::new(
                ErrorCode::NotFound,
                format!("no such file: {path}"),
                Some(path),
            )
        };
        if self.hidden(path, false) {
            return Err(not_found());
        }
        let meta = tokio::fs::metadata(&abs).await.map_err(|_| not_found())?;
        if !meta.is_file() {
            return Err(SourceError::new(
                ErrorCode::Unsupported,
                format!("not a file: {path}"),
                Some(path),
            ));
        }
        let c = classify(Path::new(path));
        let (mut kind, mut lang, mut mime) =
            (c.kind.to_string(), c.lang.map(str::to_string), c.mime);
        if kind == "binary" && self.sniff_text(&abs).await {
            kind = "text".into();
            lang = Some("text".into());
            mime = "text/plain".into();
        }
        let mtime = mtime_ms(&meta);
        let created = meta
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0);
        let git = self.git.last_commit(&abs, mtime).await;
        let size = meta.len();
        let (encoding, content) = if size > self.opts.max_inline_bytes {
            (Encoding::None, None)
        } else if INLINE_KINDS.contains(&kind.as_str()) {
            let bytes = tokio::fs::read(&abs).await.map_err(|_| not_found())?;
            (
                Encoding::Utf8,
                Some(String::from_utf8_lossy(&bytes).into_owned()),
            )
        } else {
            // Small binaries ride along as base64 so a client with no HTTP path can show them.
            let bytes = tokio::fs::read(&abs).await.map_err(|_| not_found())?;
            (
                Encoding::Base64,
                Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            )
        };
        Ok(FileData {
            path: path.to_string(),
            kind,
            lang,
            mime,
            encoding,
            content,
            size,
            mtime,
            created,
            git,
        })
    }

    async fn blame(&self, path: &str) -> Result<Option<crate::source::Blame>, SourceError> {
        let abs = self.locate(path).await?;
        let mtime = tokio::fs::metadata(&abs)
            .await
            .map(|m| mtime_ms(&m))
            .unwrap_or_default();
        Ok(self.git.blame(&abs, mtime).await)
    }

    fn hides(&self, path: &str) -> bool {
        let is_dir = resolve_inside(&self.root_dir, path)
            .ok()
            .and_then(|abs| std::fs::metadata(abs).ok())
            .is_some_and(|m| m.is_dir());
        self.hidden(path, is_dir)
    }

    async fn locate(&self, path: &str) -> Result<PathBuf, SourceError> {
        let abs = self.resolve(path)?;
        let not_found = || {
            SourceError::new(
                ErrorCode::NotFound,
                format!("no such file: {path}"),
                Some(path),
            )
        };
        if self.hidden(path, false) {
            return Err(not_found());
        }
        match tokio::fs::metadata(&abs).await {
            Ok(m) if m.is_file() => Ok(abs),
            Ok(_) => Err(SourceError::new(
                ErrorCode::Unsupported,
                format!("not a file: {path}"),
                Some(path),
            )),
            Err(_) => Err(not_found()),
        }
    }

    async fn search(&self, q: &str, limit: usize) -> Result<Vec<Entry>, SourceError> {
        let needle = q.to_lowercase();
        let mut results = Vec::new();
        let mut queue = std::collections::VecDeque::from([String::new()]);
        let mut visited = 0usize;
        'outer: while let Some(dir) = queue.pop_front() {
            if results.len() >= limit || visited >= self.opts.max_entries {
                break;
            }
            let Ok(entries) = self.list(&dir).await else {
                continue;
            };
            for e in entries {
                visited += 1;
                if e.kind == EntryKind::Dir {
                    queue.push_back(e.path.clone());
                }
                if is_subsequence(&needle, &e.path.to_lowercase()) {
                    results.push(e);
                    if results.len() >= limit {
                        break 'outer;
                    }
                }
            }
        }
        Ok(results)
    }

    async fn search_text(&self, q: &str, limit: usize) -> Result<Vec<TextHit>, SourceError> {
        /// Bigger files are skipped: they are logs or data, not documents.
        const MAX_BYTES: u64 = 1024 * 1024;
        /// Lines per file, so one noisy file cannot fill the results.
        const PER_FILE: usize = 5;
        let needle = q.to_lowercase();
        let mut hits = Vec::new();
        if needle.is_empty() {
            return Ok(hits);
        }
        let mut queue = std::collections::VecDeque::from([String::new()]);
        let mut visited = 0usize;
        while let Some(dir) = queue.pop_front() {
            if hits.len() >= limit || visited >= self.opts.max_entries {
                break;
            }
            let Ok(entries) = self.list(&dir).await else {
                continue;
            };
            for e in entries {
                visited += 1;
                if e.kind == EntryKind::Dir {
                    queue.push_back(e.path);
                    continue;
                }
                if e.size.is_some_and(|s| s > MAX_BYTES) {
                    continue;
                }
                let Ok(abs) = self.resolve(&e.path) else {
                    continue;
                };
                let Ok(bytes) = tokio::fs::read(&abs).await else {
                    continue;
                };
                if !looks_like_text(&bytes[..bytes.len().min(8192)]) {
                    continue;
                }
                let text = String::from_utf8_lossy(&bytes);
                let room = (limit - hits.len()).min(PER_FILE);
                hits.extend(text_hits(&e.path, &text, &needle, room));
                if hits.len() >= limit {
                    break;
                }
            }
        }
        Ok(hits)
    }
}
