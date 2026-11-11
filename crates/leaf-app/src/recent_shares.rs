//! Shares whose tab closed, remembered for the relay's grace period so the same root can
//! take the same link back. Pure bookkeeping: the caller passes the clock.
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub struct Recent {
    pub root: PathBuf,
    pub id: String,
    pub host_key: String,
    pub until: Instant,
}

pub struct RecentShares {
    keep: Duration,
    items: Vec<Recent>,
}

impl RecentShares {
    pub fn new(keep: Duration) -> Self {
        RecentShares {
            keep,
            items: Vec::new(),
        }
    }

    /// Remembers a share whose tab closed (one per root: a newer one replaces it).
    pub fn remember(&mut self, root: PathBuf, id: String, host_key: String, now: Instant) {
        self.items.retain(|r| r.until > now && r.root != root);
        self.items.push(Recent {
            root,
            id,
            host_key,
            until: now + self.keep,
        });
    }

    /// What `root` could resume, if still within the grace period; it stays remembered.
    pub fn peek(&self, root: &Path, now: Instant) -> Option<&Recent> {
        self.items.iter().find(|r| r.root == root && r.until > now)
    }

    /// Puts back an entry taken for a resume that failed, keeping its original deadline.
    pub fn put_back(&mut self, recent: Recent, now: Instant) {
        if recent.until > now {
            self.items.retain(|r| r.root != recent.root);
            self.items.push(recent);
        }
    }

    /// Takes what `root` could resume (once); expired entries are dropped.
    pub fn take(&mut self, root: &Path, now: Instant) -> Option<Recent> {
        self.items.retain(|r| r.until > now);
        let at = self.items.iter().position(|r| r.root == root)?;
        Some(self.items.remove(at))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_closed_share_can_be_taken_once_until_it_expires() {
        let t0 = Instant::now();
        let root = PathBuf::from("/notes");
        let mut recent = RecentShares::new(Duration::from_secs(60));
        recent.remember(root.clone(), "abc".into(), "key".into(), t0);
        let at = t0 + Duration::from_secs(30);
        assert_eq!(recent.peek(&root, at).map(|r| r.id.as_str()), Some("abc"));
        let got = recent.take(&root, at).expect("within the grace period");
        assert_eq!((got.id.as_str(), got.host_key.as_str()), ("abc", "key"));
        assert!(recent.take(&root, at).is_none(), "taken once");

        recent.remember(root.clone(), "abc".into(), "key".into(), t0);
        let late = t0 + Duration::from_secs(61);
        assert!(recent.peek(&root, late).is_none());
        assert!(recent.take(&root, late).is_none(), "expired");

        recent.remember(root.clone(), "abc".into(), "key".into(), t0);
        assert!(recent.take(Path::new("/other"), at).is_none());
    }

    #[test]
    fn a_put_back_share_keeps_its_original_deadline() {
        let t0 = Instant::now();
        let root = PathBuf::from("/notes");
        let mut recent = RecentShares::new(Duration::from_secs(60));
        recent.remember(root.clone(), "abc".into(), "key".into(), t0);
        let at = t0 + Duration::from_secs(30);
        let taken = recent.take(&root, at).unwrap();
        recent.put_back(taken, at);
        assert!(recent.peek(&root, t0 + Duration::from_secs(59)).is_some());
        assert!(recent.peek(&root, t0 + Duration::from_secs(60)).is_none());
        assert!(recent.take(&root, t0 + Duration::from_secs(61)).is_none());
    }
}
