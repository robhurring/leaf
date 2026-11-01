//! Join limits: an address that keeps asking for share ids that don't exist is guessing,
//! so after too many misses in a window its viewer upgrades are refused for a while.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Unknown-id attempts one address may make per [`WINDOW`]; the next is refused.
pub const MAX_FAILURES: usize = 10;
pub const WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Limits {
    hits: Mutex<HashMap<IpAddr, VecDeque<Instant>>>,
}

impl Limits {
    fn prune(q: &mut VecDeque<Instant>, now: Instant) {
        while q.front().is_some_and(|t| now.duration_since(*t) >= WINDOW) {
            q.pop_front();
        }
    }

    /// Whether `ip` may try to join: fewer than [`MAX_FAILURES`] misses in the last [`WINDOW`].
    pub fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        let Some(q) = hits.get_mut(&ip) else {
            return true;
        };
        Self::prune(q, now);
        if q.is_empty() {
            hits.remove(&ip);
            return true;
        }
        q.len() < MAX_FAILURES
    }

    /// Counts a miss (an unknown share id) against `ip`.
    pub fn failed(&self, ip: IpAddr) {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        // Drop addresses whose misses have all aged out, so the map can't grow without bound.
        hits.retain(|_, q| {
            Self::prune(q, now);
            !q.is_empty()
        });
        hits.entry(ip).or_default().push_back(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ten_misses_then_refused_and_others_unaffected() {
        let l = Limits::default();
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        for _ in 0..MAX_FAILURES {
            assert!(l.allow(a));
            l.failed(a);
        }
        assert!(!l.allow(a));
        assert!(l.allow(b));
    }
}
