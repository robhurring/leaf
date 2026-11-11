//! Sharing: the types a page sees (`ShareInfo`, `Peer`) and the host↔relay envelope.
use serde::{Deserialize, Serialize};

use crate::{PointerAt, RootInfo, Slide, StageRef, Stroke};

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
    /// The document this peer is reading, when they have said.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
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
    /// The slide the host is on; absent: none.
    #[serde(rename_all = "camelCase")]
    Slide {
        #[serde(skip_serializing_if = "Option::is_none")]
        slide: Option<Slide>,
    },
    /// The block the host has open full size; absent: none.
    #[serde(rename_all = "camelCase")]
    Stage {
        #[serde(skip_serializing_if = "Option::is_none")]
        stage: Option<StageRef>,
    },
    /// Where the host's pointer is; absent: it left.
    #[serde(rename_all = "camelCase")]
    Pointer {
        #[serde(skip_serializing_if = "Option::is_none")]
        pointer: Option<PointerAt>,
    },
    /// A stroke the host drew.
    #[serde(rename_all = "camelCase")]
    Ink {
        stroke: Stroke,
    },
    /// A stroke the host is still drawing: the points since its last frame for this id.
    #[serde(rename_all = "camelCase")]
    Inking {
        stroke: Stroke,
    },
    /// The host took back one of its strokes on a block: the one named, or its latest.
    #[serde(rename_all = "camelCase")]
    InkUndo {
        doc_path: String,
        block_hash: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke_id: Option<String>,
    },
    /// The host wiped its strokes on a block.
    #[serde(rename_all = "camelCase")]
    InkClear {
        doc_path: String,
        block_hash: String,
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
        /// What the relay can carry beyond the basics (such as "presence"); an older relay names none.
        #[serde(default)]
        capabilities: Vec<String>,
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
    /// Everyone in the share now, with where each is reading.
    #[serde(rename_all = "camelCase")]
    Presence {
        viewers: Vec<Peer>,
    },
    /// Where a viewer's pointer is; absent: it left.
    #[serde(rename_all = "camelCase")]
    Pointer {
        viewer: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pointer: Option<PointerAt>,
    },
    /// A stroke a viewer finished.
    #[serde(rename_all = "camelCase")]
    Ink {
        viewer: String,
        stroke: Stroke,
    },
    /// A stroke a viewer is still drawing: the points since its last frame for this id.
    #[serde(rename_all = "camelCase")]
    Inking {
        viewer: String,
        stroke: Stroke,
    },
    /// A viewer took back one of its strokes on a block: the one named, or its latest.
    #[serde(rename_all = "camelCase")]
    InkUndo {
        viewer: String,
        doc_path: String,
        block_hash: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stroke_id: Option<String>,
    },
    /// A viewer wiped its strokes on a block.
    #[serde(rename_all = "camelCase")]
    InkClear {
        viewer: String,
        doc_path: String,
        block_hash: String,
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
            HostToRelay::Slide {
                slide: Some(Slide {
                    path: "deck.md".into(),
                    index: 3,
                }),
            },
            HostToRelay::Stage {
                stage: Some(StageRef {
                    doc_path: "a.mmd".into(),
                    block_hash: "h".into(),
                }),
            },
            HostToRelay::Pointer {
                pointer: Some(PointerAt {
                    doc_path: "a.mmd".into(),
                    block_hash: "h".into(),
                    x: 10.5,
                    y: 20.0,
                }),
            },
            HostToRelay::Ink {
                stroke: Stroke {
                    id: "host:1".into(),
                    doc_path: "a.mmd".into(),
                    block_hash: "h".into(),
                    points: vec![[0.0, 0.0], [10.5, 4.0]],
                    color: "red".into(),
                    width: 4.0,
                    sticky: true,
                    created_at: 1.0,
                },
            },
            HostToRelay::InkUndo {
                doc_path: "a.mmd".into(),
                block_hash: "h".into(),
                stroke_id: Some("host:1".into()),
            },
            HostToRelay::InkClear {
                doc_path: "a.mmd".into(),
                block_hash: "h".into(),
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
                    path: Some("a.md".into()),
                }],
                capabilities: vec!["presence".into()],
            },
            RelayToHost::Presence {
                viewers: vec![Peer {
                    id: "v1".into(),
                    name: "Brisk Otter".into(),
                    color: "#10b981".into(),
                    path: None,
                }],
            },
            RelayToHost::Pointer {
                viewer: "v1".into(),
                pointer: Some(PointerAt {
                    doc_path: "a.mmd".into(),
                    block_hash: "h".into(),
                    x: 1.0,
                    y: 2.0,
                }),
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
        // An older relay's `shared` has no viewers or capabilities.
        let old = r#"{"type":"shared","id":"i","hostKey":"k","webUrl":"w","appUrl":"a"}"#;
        assert!(matches!(
            serde_json::from_str::<RelayToHost>(old).unwrap(),
            RelayToHost::Shared { viewers, capabilities, .. }
                if viewers.is_empty() && capabilities.is_empty()
        ));
    }
}
