use serde::{Deserialize, Serialize};

use crate::{PointerAt, Preferences, Slide, StageRef, Stroke};

/// What a client sends. `id` lets the server mark its reply with `inReplyTo`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClientMessage {
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol: u8,
        /// Who is asking, when the client knows (a viewer of a shared session).
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    List {
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Read {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Subscribe {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Unsubscribe {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Search {
        q: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    SearchText {
        q: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Preferences {
        preferences: Preferences,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    /// Who last changed each line of a file, from git.
    #[serde(rename_all = "camelCase")]
    Blame {
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },
    /// Where a peer is reading; absent: nowhere.
    #[serde(rename_all = "camelCase")]
    At {
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
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
    /// Where a peer's pointer is on the open block; absent: it left.
    #[serde(rename_all = "camelCase")]
    Pointer {
        #[serde(skip_serializing_if = "Option::is_none")]
        pointer: Option<PointerAt>,
    },
    /// A stroke the host has drawn.
    #[serde(rename_all = "camelCase")]
    Ink { stroke: Stroke },
    /// Take back the host's last stroke on a block.
    #[serde(rename_all = "camelCase")]
    InkUndo {
        doc_path: String,
        block_hash: String,
    },
    /// Wipe the host's strokes on a block.
    #[serde(rename_all = "camelCase")]
    InkClear {
        doc_path: String,
        block_hash: String,
    },
}

impl ClientMessage {
    pub fn id(&self) -> Option<&str> {
        match self {
            ClientMessage::Hello { id, .. }
            | ClientMessage::List { id, .. }
            | ClientMessage::Read { id, .. }
            | ClientMessage::Subscribe { id, .. }
            | ClientMessage::Unsubscribe { id, .. }
            | ClientMessage::Search { id, .. }
            | ClientMessage::SearchText { id, .. }
            | ClientMessage::Preferences { id, .. }
            | ClientMessage::Blame { id, .. } => id.as_deref(),
            ClientMessage::At { .. }
            | ClientMessage::Slide { .. }
            | ClientMessage::Stage { .. }
            | ClientMessage::Pointer { .. }
            | ClientMessage::Ink { .. }
            | ClientMessage::InkUndo { .. }
            | ClientMessage::InkClear { .. } => None,
        }
    }
}

pub const CLIENT_MESSAGE_TYPES: &[&str] = &[
    "hello",
    "list",
    "read",
    "subscribe",
    "unsubscribe",
    "search",
    "searchText",
    "preferences",
    "blame",
    "at",
    "slide",
    "stage",
    "pointer",
    "ink",
    "inkUndo",
    "inkClear",
];

pub fn is_known_client_type(t: &str) -> bool {
    CLIENT_MESSAGE_TYPES.contains(&t)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    InvalidJson,
    UnknownType(String),
    Invalid(String),
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::InvalidJson => write!(f, "invalid JSON"),
            ParseError::UnknownType(t) => write!(f, "unknown message type: {t}"),
            ParseError::Invalid(m) => write!(f, "{m}"),
        }
    }
}
impl std::error::Error for ParseError {}

/// Parses one frame from a client: invalid JSON, an unknown `type`, or a bad shape are told apart.
pub fn parse_client(raw: &str) -> Result<ClientMessage, ParseError> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| ParseError::InvalidJson)?;
    if let Some(t) = value.get("type").and_then(|t| t.as_str())
        && !is_known_client_type(t)
    {
        return Err(ParseError::UnknownType(t.to_string()));
    }
    serde_json::from_value(value).map_err(|e| ParseError::Invalid(e.to_string()))
}
