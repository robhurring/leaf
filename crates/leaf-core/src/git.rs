//! Last-commit lookup for files inside a git repository, by shelling out to
//! `git` as the person's own checkout would. Best effort: any failure (no git,
//! not a repo, an untracked file) is simply "no info".
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use leaf_protocol::{BlameHunk, GitInfo};

use crate::source::Blame;
use tokio::process::Command;

const SEP: char = '\u{1f}';

/// `git@github.com:a/b.git`, `ssh://git@host:2222/a/b.git`, `https://u:t@host/a/b.git` → `https://host/a/b`.
pub fn remote_to_web_url(remote: &str) -> Option<String> {
    let trimmed = remote.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (host, path) = if let Some((scheme, rest)) = trimmed.split_once("://") {
        if !matches!(scheme, "http" | "https" | "ssh" | "git") {
            return None;
        }
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (hostport, path) = rest.split_once('/').unwrap_or((rest, ""));
        let host = hostport.split_once(':').map(|(h, _)| h).unwrap_or(hostport);
        (host.to_string(), path.to_string())
    } else {
        // scp-like: [user@]host:path, where path does not start with '/'
        let (userhost, path) = trimmed.split_once(':')?;
        if path.starts_with('/') || path.contains(char::is_whitespace) {
            return None;
        }
        let host = userhost
            .rsplit_once('@')
            .map(|(_, h)| h)
            .unwrap_or(userhost);
        if host.is_empty()
            || !host
                .chars()
                .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_'))
        {
            return None;
        }
        (host.to_string(), path.to_string())
    };
    if host.is_empty() {
        return None;
    }
    let path = path.trim_start_matches('/').trim_end_matches('/');
    let path = path
        .strip_suffix(".git")
        .unwrap_or(path)
        .trim_end_matches('/');
    if path.is_empty() {
        return None;
    }
    Some(format!("https://{host}/{path}"))
}

async fn git(cwd: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let out = tokio::time::timeout(
        timeout,
        Command::new("git").args(args).current_dir(cwd).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Default)]
struct Lazy<T: Clone> {
    value: Mutex<Option<T>>,
}
impl<T: Clone> Lazy<T> {
    fn get(&self) -> Option<T> {
        self.value.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    fn set(&self, v: T) -> T {
        *self.value.lock().unwrap_or_else(|e| e.into_inner()) = Some(v.clone());
        v
    }
}

pub struct GitInfoProvider {
    root_dir: PathBuf,
    repo_root: Lazy<Option<PathBuf>>,
    remote: Lazy<Option<String>>,
    cache: Mutex<HashMap<PathBuf, (f64, Option<GitInfo>)>>,
    blames: Mutex<HashMap<PathBuf, (f64, Option<Vec<BlameHunk>>)>>,
}

impl GitInfoProvider {
    pub fn new(root_dir: &Path) -> GitInfoProvider {
        GitInfoProvider {
            root_dir: root_dir.to_path_buf(),
            repo_root: Lazy::default(),
            remote: Lazy::default(),
            cache: Mutex::new(HashMap::new()),
            blames: Mutex::new(HashMap::new()),
        }
    }

    async fn repo_root(&self) -> Option<PathBuf> {
        if let Some(v) = self.repo_root.get() {
            return v;
        }
        let found = git(
            &self.root_dir,
            &["rev-parse", "--show-toplevel"],
            Duration::from_secs(2),
        )
        .await
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
        self.repo_root.set(found)
    }

    async fn repo_url(&self) -> Option<String> {
        if let Some(v) = self.remote.get() {
            return v;
        }
        let url = git(
            &self.root_dir,
            &["remote", "get-url", "origin"],
            Duration::from_secs(2),
        )
        .await
        .and_then(|s| remote_to_web_url(&s));
        self.remote.set(url)
    }

    /// The last commit touching `abs`, cached per path and mtime.
    pub async fn last_commit(&self, abs: &Path, mtime: f64) -> Option<GitInfo> {
        {
            let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((m, info)) = cache.get(abs)
                && *m == mtime
            {
                return info.clone();
            }
        }
        let info = self.lookup(abs).await;
        self.cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(abs.to_path_buf(), (mtime, info.clone()));
        info
    }

    /// Who last changed each line of `abs`, cached per path and mtime. None when the
    /// file isn't tracked (or git isn't there).
    pub async fn blame(&self, abs: &Path, mtime: f64) -> Option<Blame> {
        let cached = {
            let cache = self.blames.lock().unwrap_or_else(|e| e.into_inner());
            cache
                .get(abs)
                .filter(|(m, _)| *m == mtime)
                .map(|(_, h)| h.clone())
        };
        let hunks = match cached {
            Some(h) => h,
            None => {
                let h = self.blame_lookup(abs).await;
                self.blames
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(abs.to_path_buf(), (mtime, h.clone()));
                h
            }
        };
        Some(Blame {
            hunks: hunks?,
            repo_url: self.repo_url().await,
        })
    }

    async fn blame_lookup(&self, abs: &Path) -> Option<Vec<BlameHunk>> {
        self.repo_root().await?;
        let abs_str = abs.to_string_lossy();
        let out = git(
            &self.root_dir,
            &["blame", "--incremental", "--", &abs_str],
            Duration::from_secs(10),
        )
        .await?;
        Some(parse_incremental(&out))
    }

    async fn lookup(&self, abs: &Path) -> Option<GitInfo> {
        self.repo_root().await?;
        let format = format!("--format=%H{SEP}%an{SEP}%at{SEP}%s");
        let abs_str = abs.to_string_lossy();
        let line = git(
            &self.root_dir,
            &["log", "-1", &format, "--", &abs_str],
            Duration::from_secs(3),
        )
        .await?;
        if line.is_empty() {
            return None;
        }
        let mut parts = line.splitn(4, SEP);
        let commit = parts.next()?.to_string();
        let author = parts.next().unwrap_or("").to_string();
        let at: i64 = parts.next()?.trim().parse().ok()?;
        let message = parts.next().unwrap_or("").to_string();
        if commit.is_empty() {
            return None;
        }
        Some(GitInfo {
            commit,
            author,
            date: at * 1000,
            message,
            repo_url: self.repo_url().await,
        })
    }
}

/// Parses `git blame --incremental`: hunks in any order, each a `<sha> <orig> <final>
/// <count>` line, the commit's headers the first time it appears, then `filename`.
/// Returns them in line order, neighbours from the same commit merged.
pub fn parse_incremental(out: &str) -> Vec<BlameHunk> {
    #[derive(Default, Clone)]
    struct Commit {
        author: String,
        time: i64,
        summary: String,
    }
    let mut commits: HashMap<String, Commit> = HashMap::new();
    let mut raw: Vec<(String, u32, u32)> = Vec::new();
    let mut current: Option<String> = None;
    for line in out.lines() {
        let mut parts = line.split(' ');
        let first = parts.next().unwrap_or("");
        let is_head = first.len() == 40 && first.bytes().all(|b| b.is_ascii_hexdigit());
        if is_head {
            let nums: Vec<u32> = parts.filter_map(|p| p.parse().ok()).collect();
            if let [_, start, count] = nums[..] {
                raw.push((first.to_string(), start, count));
                commits.entry(first.to_string()).or_default();
                current = Some(first.to_string());
            }
            continue;
        }
        let Some(sha) = &current else { continue };
        let c = commits.entry(sha.clone()).or_default();
        if let Some(v) = line.strip_prefix("author ") {
            c.author = v.to_string();
        } else if let Some(v) = line.strip_prefix("author-time ") {
            c.time = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("summary ") {
            c.summary = v.to_string();
        } else if line.starts_with("filename ") {
            current = None;
        }
    }
    raw.sort_by_key(|(_, start, _)| *start);
    let mut hunks: Vec<BlameHunk> = Vec::new();
    for (sha, start, count) in raw {
        if let Some(last) = hunks.last_mut()
            && last.commit == sha
            && last.start + last.lines == start
        {
            last.lines += count;
            continue;
        }
        let uncommitted = sha.bytes().all(|b| b == b'0');
        let c = commits.get(&sha).cloned().unwrap_or_default();
        hunks.push(if uncommitted {
            BlameHunk {
                start,
                lines: count,
                commit: sha,
                author: String::new(),
                date: 0,
                summary: String::new(),
                uncommitted: true,
            }
        } else {
            BlameHunk {
                start,
                lines: count,
                commit: sha,
                author: c.author,
                date: c.time * 1000,
                summary: c.summary,
                uncommitted: false,
            }
        });
    }
    hunks
}
