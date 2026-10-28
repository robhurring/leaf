//! Last-commit lookup for files inside a git repository, by shelling out to
//! `git` as the person's own checkout would. Best effort: any failure (no git,
//! not a repo, an untracked file) is simply "no info".
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use leaf_protocol::GitInfo;
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
}

impl GitInfoProvider {
    pub fn new(root_dir: &Path) -> GitInfoProvider {
        GitInfoProvider {
            root_dir: root_dir.to_path_buf(),
            repo_root: Lazy::default(),
            remote: Lazy::default(),
            cache: Mutex::new(HashMap::new()),
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
