//! leaf's core. Nothing in here knows about sockets, windows, or HTTP.
pub mod classify;
pub mod config;
pub mod disk;
pub mod engine;
pub mod git;
pub mod ignore;
pub mod paths;
pub mod prefs;
pub mod source;
#[cfg(any(test, feature = "testing"))]
pub mod testing;
pub mod watch;
