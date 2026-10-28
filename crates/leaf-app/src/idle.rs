//! Ends a server nobody is looking at. Two windows: a startup grace while the
//! browser is still opening, and a short idle grace once the last client goes
//! away (long enough for a reload to reconnect, short enough that a closed tab
//! stops the process). An idle duration of zero disables both.
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct State {
    startup: Duration,
    idle: Duration,
    on_idle: Arc<dyn Fn() + Send + Sync>,
    timer: Option<tokio::task::JoinHandle<()>>,
    fired: bool,
    stopped: bool,
}

#[derive(Clone)]
pub struct IdleGuard {
    state: Arc<Mutex<State>>,
}

impl IdleGuard {
    pub fn new(
        startup: Duration,
        idle: Duration,
        on_idle: Arc<dyn Fn() + Send + Sync>,
    ) -> IdleGuard {
        let guard = IdleGuard {
            state: Arc::new(Mutex::new(State {
                startup,
                idle,
                on_idle,
                timer: None,
                fired: false,
                stopped: false,
            })),
        };
        let startup = guard
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .startup;
        guard.arm(startup);
        guard
    }

    fn arm(&self, after: Duration) {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if s.idle.is_zero() || s.fired || s.stopped {
            return;
        }
        if let Some(t) = s.timer.take() {
            t.abort();
        }
        let state = self.state.clone();
        s.timer = Some(tokio::spawn(async move {
            tokio::time::sleep(after).await;
            let callback = {
                let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                if s.stopped || s.fired {
                    return;
                }
                s.fired = true;
                s.on_idle.clone()
            };
            callback();
        }));
    }

    fn disarm(&self) {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = s.timer.take() {
            t.abort();
        }
    }

    /// The number of connected clients changed.
    pub fn clients(&self, n: usize) {
        if n > 0 {
            self.disarm();
        } else {
            let idle = self.state.lock().unwrap_or_else(|e| e.into_inner()).idle;
            self.arm(idle);
        }
    }

    pub fn stop(&self) {
        {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            s.stopped = true;
        }
        self.disarm();
    }
}
