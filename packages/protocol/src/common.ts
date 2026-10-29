import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

export const Entry = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(['file', 'dir']),
  size: z.number().optional(),
  mtime: z.number().optional(),
  hasChildren: z.boolean().optional(),
});
export type Entry = z.infer<typeof Entry>;

export const Capabilities = z.object({
  watch: z.boolean(),
  write: z.boolean(),
  collaborate: z.boolean(),
  /** The server also serves file bytes at `/raw/<path>` over HTTP. Absent: fetch assets over the socket. */
  rawUrls: z.boolean().optional(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const Config = z.object({
  plantumlUrl: z.string().optional(),
  mentionUrl: z.string().optional(),
  topicUrl: z.string().optional(),
  /** Server cap for expand-all and search, so the UI can stop and say so. */
  maxEntries: z.number().int().positive().optional(),
});
export type Config = z.infer<typeof Config>;

/** Reader settings the server keeps for the person across launches. Every field optional: a patch. */
export const Preferences = z.object({
  theme: z.enum(['github', 'glass', 'card', 'paper']).optional(),
  appearance: z.enum(['light', 'dark', 'auto']).optional(),
  treeOpen: z.boolean().optional(),
  outlineOpen: z.boolean().optional(),
  numbering: z.boolean().optional(),
  textPct: z.number().int().min(50).max(200).optional(),
  treeWidth: z.number().int().min(160).max(480).optional(),
  outlineWidth: z.number().int().min(160).max(480).optional(),
  /** The kinds of link (URL schemes) the app window hands to other apps. */
  linkSchemes: z.array(z.string().regex(/^[a-z][a-z0-9+.-]*$/)).optional(),
});
export type Preferences = z.infer<typeof Preferences>;

/** The link kinds the app window opens until the person changes the list: the web,
 *  mail, and the editors people jump to code in. Same as the Rust core's. */
export const DEFAULT_LINK_SCHEMES: readonly string[] = [
  'https',
  'http',
  'mailto',
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'zed',
];

export const Participant = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});
export type Participant = z.infer<typeof Participant>;

export const ErrorCode = z.enum([
  'not_found',
  'outside_root',
  'unsupported',
  'bad_request',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Built-in file kinds. `kind` is an open string so viewers can add their own. */
export const FILE_KINDS = ['markdown', 'text', 'image', 'media', 'pdf', 'binary'] as const;
export const FileKind = z.string();
export type FileKind = z.infer<typeof FileKind>;

/** The last commit that touched a file, when the root is inside a git repository. */
export const GitInfo = z.object({
  commit: z.string(),
  author: z.string(),
  date: z.number(),
  message: z.string(),
  /** Web URL of the repository (from the origin remote), when it can be derived. */
  repoUrl: z.string().optional(),
});
export type GitInfo = z.infer<typeof GitInfo>;

/** Consecutive lines last changed by the same commit (`git blame`, grouped). */
export const BlameHunk = z.object({
  /** 1-based first line. */
  start: z.number().int().positive(),
  lines: z.number().int().positive(),
  commit: z.string(),
  author: z.string(),
  /** Unix milliseconds of the commit's author date. */
  date: z.number(),
  summary: z.string(),
  /** Changed in the working tree and not committed yet (no commit, author, or date). */
  uncommitted: z.boolean().optional(),
});
export type BlameHunk = z.infer<typeof BlameHunk>;

export const RootInfo = z.object({ kind: z.enum(['file', 'dir']), name: z.string() });
export type RootInfo = z.infer<typeof RootInfo>;

/** Fields every message may carry. */
export const envelope = { id: z.string().optional() };
export const replyEnvelope = { ...envelope, inReplyTo: z.string().optional() };
