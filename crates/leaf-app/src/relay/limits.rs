//! Join limits: an address that keeps asking for share ids that don't exist is guessing,
//! so after too many misses in a window its viewer upgrades are refused for a while.
//! A miss counts once per (address, id) per window: a viewer page retrying an ended
//! share asks for the same id again and again, which tells it nothing new; walking
//! takes distinct ids.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Distinct unknown ids one address may ask for per [`WINDOW`]; the next ask is refused.
pub const MAX_FAILURES: usize = 10;
pub const WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Limits {
    hits: Mutex<HashMap<IpAddr, VecDeque<(Instant, String)>>>,
}

impl Limits {
    fn prune(q: &mut VecDeque<(Instant, String)>, now: Instant) {
        while q
            .front()
            .is_some_and(|(t, _)| now.duration_since(*t) >= WINDOW)
        {
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

    /// Counts a miss (an unknown share `id`) against `ip`, unless `ip` already missed
    /// on that id within the window.
    pub fn failed(&self, ip: IpAddr, id: &str) {
        let now = Instant::now();
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        // Drop addresses whose misses have all aged out, so the map can't grow without bound.
        hits.retain(|_, q| {
            Self::prune(q, now);
            !q.is_empty()
        });
        let q = hits.entry(ip).or_default();
        if !q.iter().any(|(_, seen)| seen == id) {
            q.push_back((now, id.to_string()));
        }
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
        for i in 0..MAX_FAILURES {
            assert!(l.allow(a));
            l.failed(a, &format!("id-{i}"));
        }
        assert!(!l.allow(a));
        assert!(l.allow(b));
    }

    #[test]
    fn repeats_on_one_id_count_once() {
        let l = Limits::default();
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        for _ in 0..50 {
            l.failed(a, "aaa-bbb-ccc");
        }
        assert!(l.allow(a));
    }
}
