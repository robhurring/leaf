import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  BlameHunk,
  Capabilities,
  Config,
  Entry,
  ErrorCode,
  FileKind,
  GitInfo,
  Participant,
  Preferences,
  RootInfo,
  replyEnvelope,
} from './common.js';
import { Peer, ShareInfo } from './relay.js';

export const WelcomeMessage = z.object({
  type: z.literal('welcome'),
  protocol: z.literal(PROTOCOL_VERSION),
  root: RootInfo,
  config: Config,
  capabilities: Capabilities,
  participant: Participant,
  /** Present when the server stores preferences; the client then sends its changes back. */
  preferences: Preferences.optional(),
  /** Present when this session is shared. */
  share: ShareInfo.optional(),
  ...replyEnvelope,
});
export const TreeMessage = z.object({
  type: z.literal('tree'),
  path: z.string(),
  entries: z.array(Entry),
  ...replyEnvelope,
});
export const FileMessage = z.object({
  type: z.literal('file'),
  path: z.string(),
  kind: FileKind,
  lang: z.string().optional(),
  mime: z.string(),
  /** utf8: text in `content`; base64: bytes in `content` (small binaries); none: fetch `url`. */
  encoding: z.enum(['utf8', 'base64', 'none']),
  content: z.string().optional(),
  url: z.string(),
  size: z.number(),
  mtime: z.number(),
  /** Unix milliseconds the file was created, where the filesystem records it. */
  created: z.number().optional(),
  git: GitInfo.optional(),
  ...replyEnvelope,
});
export const ChangedMessage = z.object({
  type: z.literal('changed'),
  path: z.string(),
  change: z.enum(['created', 'modified', 'deleted', 'renamed']),
  from: z.string().optional(),
  ...replyEnvelope,
});
export const MatchesMessage = z.object({
  type: z.literal('matches'),
  q: z.string(),
  entries: z.array(Entry),
  ...replyEnvelope,
});
/** One line containing the query: 1-based line number and the line's text. */
export const TextHit = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
});
export const TextMatchesMessage = z.object({
  type: z.literal('textMatches'),
  q: z.string(),
  hits: z.array(TextHit),
  ...replyEnvelope,
});
/** The reply to `blame`: line groups in order; empty when the file isn't in git. */
export const BlameHunksMessage = z.object({
  type: z.literal('blameHunks'),
  path: z.string(),
  hunks: z.array(BlameHunk),
  /** Web URL of the repository, for linking commits. */
  repoUrl: z.string().optional(),
  ...replyEnvelope,
});
/** Who is in a shared session and what the host is reading. */
export const PresenceMessage = z.object({
  type: z.literal('presence'),
  host: Peer,
  hostPath: z.string().optional(),
  viewers: z.array(Peer),
  /** The receiving viewer's own id. */
  you: z.string(),
  ...replyEnvelope,
});
export const ShareState = z.enum(['live', 'reconnecting', 'ended']);
export type ShareState = z.infer<typeof ShareState>;
export const ShareStatusMessage = z.object({
  type: z.literal('shareStatus'),
  state: ShareState,
  reason: z.string().optional(),
  ...replyEnvelope,
});
export const ErrorMessage = z.object({
  type: z.literal('error'),
  code: ErrorCode,
  message: z.string(),
  path: z.string().optional(),
  ...replyEnvelope,
});

export const ServerMessage = z.discriminatedUnion('type', [
  WelcomeMessage,
  TreeMessage,
  FileMessage,
  ChangedMessage,
  MatchesMessage,
  TextMatchesMessage,
  BlameHunksMessage,
  PresenceMessage,
  ShareStatusMessage,
  ErrorMessage,
]);

export type WelcomeMessage = z.infer<typeof WelcomeMessage>;
export type TreeMessage = z.infer<typeof TreeMessage>;
export type FileMessage = z.infer<typeof FileMessage>;
export type ChangedMessage = z.infer<typeof ChangedMessage>;
export type MatchesMessage = z.infer<typeof MatchesMessage>;
export type TextHit = z.infer<typeof TextHit>;
export type TextMatchesMessage = z.infer<typeof TextMatchesMessage>;
export type BlameHunksMessage = z.infer<typeof BlameHunksMessage>;
export type PresenceMessage = z.infer<typeof PresenceMessage>;
export type ShareStatusMessage = z.infer<typeof ShareStatusMessage>;
export type ErrorMessage = z.infer<typeof ErrorMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
export type ServerMessageType = ServerMessage['type'];

export const SERVER_MESSAGE_TYPES: readonly ServerMessageType[] = ServerMessage.options.map(
  (o) => o.shape.type.value,
);

export function parseServerMessage(input: unknown): ServerMessage {
  return ServerMessage.parse(input);
}

export function isKnownServerType(type: string): type is ServerMessageType {
  return (SERVER_MESSAGE_TYPES as readonly string[]).includes(type);
}
