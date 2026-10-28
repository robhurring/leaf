//! The leaf document protocol: every message a client and a server exchange.
//! The shapes are the JSON Schema export in `packages/protocol/schema`; the
//! tests in `tests/schema.rs` hold these types to it exactly.
mod client;
mod common;
mod server;

pub use client::*;
pub use common::*;
pub use server::*;

/// The protocol version carried in `hello` and `welcome`.
pub const PROTOCOL_VERSION: u8 = 1;
