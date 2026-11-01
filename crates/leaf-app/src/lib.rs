//! leaf reader's library: serve mode (HTTP + WebSocket over the core's Engine), the
//! window layer, and the CLI helpers. The Tauri app itself lives in the binary
//! (src/app.rs), so tests never link the webview.
pub mod cli;
pub mod http;
pub mod idle;
pub mod instances;
pub mod launch;
pub mod log;
pub mod serve;
pub mod session;
pub mod tabs;
pub mod welcome;
pub mod window;
pub mod window_state;
pub mod ws;
