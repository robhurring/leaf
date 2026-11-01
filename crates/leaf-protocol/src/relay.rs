//! Sharing: the types a page sees (`ShareInfo`, `Peer`) and the host↔relay envelope.
use serde::{Deserialize, Serialize};

use crate::RootInfo;

/// The host-link envelope's own version, apart from the page protocol (the spec's peer-message class grows here).
pub const RELAY_PROTOCOL: u8 = 1;
/// Binary frame host→relay: 4-byte big-endian `req` then bytes (≤ 256 KiB per frame).
pub const CHUNK_BYTES: usize = 256 * 1024;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ShareMode {
    ReadOnly,
}

/// Someone in a shared session: the host or a viewer.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShareInfo {
    pub id: String,
    pub host: Peer,
    pub mode: ShareMode,
    pub web_url: String,
    pub app_url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    pub id: String,
    pub host_key: String,
}

/// What the host sends the relay.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostToRelay {
    #[serde(rename_all = "camelCase")]
    Share {
        protocol: u8,
        relay_protocol: u8,
        name: String,
        root: RootInfo,
        mode: ShareMode,
        #[serde(skip_serializing_if = "Option::is_none")]
        resume: Option<Resume>,
    },
    #[serde(rename_all = "camelCase")]
    ToViewer {
        viewer: String,
        msg: serde_json::Value,
    },
    /// What the host is reading now.
    #[serde(rename_all = "camelCase")]
    Path {
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Fetched {
        req: u32,
        status: u16,
        headers: Vec<(String, String)>,
    },
    End,
    Pong,
}

/// What the relay sends the host.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RelayToHost {
    #[serde(rename_all = "camelCase")]
    Shared {
        id: String,
        host_key: String,
        web_url: String,
        app_url: String,
        /// The share's viewers now: on a resume, the host drops sessions for any others.
        #[serde(default)]
        viewers: Vec<Peer>,
    },
    #[serde(rename_all = "camelCase")]
    Joined {
        viewer: String,
        name: String,
        color: String,
    },
    #[serde(rename_all = "camelCase")]
    Left {
        viewer: String,
    },
    #[serde(rename_all = "camelCase")]
    FromViewer {
        viewer: String,
        msg: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    Fetch {
        req: u32,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        range: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Cancel {
        req: u32,
    },
    /// Stop sending `req`'s bytes for now: its client has fallen behind.
    #[serde(rename_all = "camelCase")]
    Pause {
        req: u32,
    },
    /// Go on sending `req`'s bytes after a `pause`.
    #[serde(rename_all = "camelCase")]
    Resume {
        req: u32,
    },
    Ping,
    /// Codes: "version", "bad-key", "unknown-share".
    #[serde(rename_all = "camelCase")]
    Error {
        code: String,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::EntryKind;
    use serde_json::json;

    #[test]
    fn host_and_relay_messages_round_trip() {
        let host = [
            HostToRelay::Share {
                protocol: 1,
                relay_protocol: RELAY_PROTOCOL,
                name: "Rob".into(),
                root: RootInfo {
                    kind: EntryKind::Dir,
                    name: "docs".into(),
                },
                mode: ShareMode::ReadOnly,
                resume: Some(Resume {
                    id: "brisk-otter-lantern".into(),
                    host_key: "k".into(),
                }),
            },
            HostToRelay::ToViewer {
                viewer: "v1".into(),
                msg: json!({"type": "tree"}),
            },
            HostToRelay::Path {
                path: Some("a.md".into()),
            },
            HostToRelay::Fetched {
                req: 7,
                status: 206,
                headers: vec![("content-type".into(), "image/png".into())],
            },
            HostToRelay::End,
            HostToRelay::Pong,
        ];
        for m in host {
            let text = serde_json::to_string(&m).unwrap();
            assert_eq!(serde_json::from_str::<HostToRelay>(&text).unwrap(), m);
        }
        let relay = [
            RelayToHost::Shared {
                id: "i".into(),
                host_key: "k".into(),
                web_url: "https://r/s/i".into(),
                app_url: "leaf://relay/r/s/i".into(),
                viewers: vec![Peer {
                    id: "v1".into(),
                    name: "Brisk Otter".into(),
                    color: "#10b981".into(),
                }],
            },
            RelayToHost::Joined {
                viewer: "v1".into(),
                name: "Brisk Otter".into(),
                color: "#10b981".into(),
            },
            RelayToHost::Left {
                viewer: "v1".into(),
            },
            RelayToHost::FromViewer {
                viewer: "v1".into(),
                msg: json!({"type": "list"}),
            },
            RelayToHost::Fetch {
                req: 7,
                path: "a.png".into(),
                range: Some("bytes=0-".into()),
            },
            RelayToHost::Cancel { req: 7 },
            RelayToHost::Pause { req: 7 },
            RelayToHost::Resume { req: 7 },
            RelayToHost::Ping,
            RelayToHost::Error {
                code: "bad-key".into(),
                message: "no".into(),
            },
        ];
        for m in relay {
            let text = serde_json::to_string(&m).unwrap();
            assert_eq!(serde_json::from_str::<RelayToHost>(&text).unwrap(), m);
        }
        // An older relay's `shared` has no viewers.
        let old = r#"{"type":"shared","id":"i","hostKey":"k","webUrl":"w","appUrl":"a"}"#;
        assert!(matches!(
            serde_json::from_str::<RelayToHost>(old).unwrap(),
            RelayToHost::Shared { viewers, .. } if viewers.is_empty()
        ));
    }
}
