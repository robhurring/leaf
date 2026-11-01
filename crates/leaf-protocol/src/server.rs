use serde::{Deserialize, Serialize};

use crate::{
    BlameHunk, Capabilities, Change, Config, Encoding, Entry, ErrorCode, GitInfo, Participant,
    Peer, Preferences, RootInfo, ShareInfo,
};

/// One line containing a text query: 1-based line number and the line's text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

/// Where a shared session stands, from the host's side.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShareState {
    Live,
    Reconnecting,
    Ended,
}

/// What a server sends: replies carry `inReplyTo`; pushes (`changed`) do not.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ServerMessage {
    #[serde(rename_all = "camelCase")]
    Welcome {
        protocol: u8,
        root: RootInfo,
        config: Config,
        capabilities: Capabilities,
        participant: Participant,
        /// Present when the server stores preferences; the client then sends its changes back.
        #[serde(skip_serializing_if = "Option::is_none")]
        preferences: Option<Preferences>,
        /// Present when this session is shared.
        #[serde(skip_serializing_if = "Option::is_none")]
        share: Option<ShareInfo>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Tree {
        path: String,
        entries: Vec<Entry>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    File {
        path: String,
        kind: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        lang: Option<String>,
        mime: String,
        encoding: Encoding,
        #[serde(skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        url: String,
        size: u64,
        mtime: f64,
        /// Unix milliseconds the file was created, where the filesystem records it.
        #[serde(skip_serializing_if = "Option::is_none")]
        created: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        git: Option<GitInfo>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Changed {
        path: String,
        change: Change,
        #[serde(skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Matches {
        q: String,
        entries: Vec<Entry>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    TextMatches {
        q: String,
        hits: Vec<TextHit>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    /// The reply to `blame`: line groups in order; empty when the file isn't in git.
    #[serde(rename_all = "camelCase")]
    BlameHunks {
        path: String,
        hunks: Vec<BlameHunk>,
        #[serde(skip_serializing_if = "Option::is_none")]
        repo_url: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    /// Who is in a shared session and what the host is reading.
    #[serde(rename_all = "camelCase")]
    Presence {
        host: Peer,
        #[serde(skip_serializing_if = "Option::is_none")]
        host_path: Option<String>,
        viewers: Vec<Peer>,
        /// The receiving viewer's own id.
        you: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ShareStatus {
        state: ShareState,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        code: ErrorCode,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_reply_to: Option<String>,
    },
}

impl ServerMessage {
    /// The same message marked as the reply to `id`.
    pub fn in_reply_to(mut self, id: Option<&str>) -> ServerMessage {
        let slot = match &mut self {
            ServerMessage::Welcome { in_reply_to, .. }
            | ServerMessage::Tree { in_reply_to, .. }
            | ServerMessage::File { in_reply_to, .. }
            | ServerMessage::Changed { in_reply_to, .. }
            | ServerMessage::Matches { in_reply_to, .. }
            | ServerMessage::TextMatches { in_reply_to, .. }
            | ServerMessage::BlameHunks { in_reply_to, .. }
            | ServerMessage::Presence { in_reply_to, .. }
            | ServerMessage::ShareStatus { in_reply_to, .. }
            | ServerMessage::Error { in_reply_to, .. } => in_reply_to,
        };
        *slot = id.map(str::to_string);
        self
    }

    pub fn error(
        code: ErrorCode,
        message: impl Into<String>,
        path: Option<String>,
    ) -> ServerMessage {
        ServerMessage::Error {
            code,
            message: message.into(),
            path,
            in_reply_to: None,
        }
    }
}
