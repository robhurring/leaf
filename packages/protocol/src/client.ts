import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  PointerAt,
  Preferences,
  Slide,
  StageRef,
  Stroke,
  envelope,
} from './common.js';

export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.literal(PROTOCOL_VERSION),
  /** Who is asking, when the client knows (a viewer of a shared session). */
  name: z.string().optional(),
  ...envelope,
});
export const ListMessage = z.object({
  type: z.literal('list'),
  path: z.string().optional(),
  ...envelope,
});
export const ReadMessage = z.object({ type: z.literal('read'), path: z.string(), ...envelope });
export const SubscribeMessage = z.object({
  type: z.literal('subscribe'),
  path: z.string(),
  ...envelope,
});
export const UnsubscribeMessage = z.object({
  type: z.literal('unsubscribe'),
  path: z.string(),
  ...envelope,
});
export const SearchMessage = z.object({
  type: z.literal('search'),
  q: z.string(),
  limit: z.number().int().positive().optional(),
  ...envelope,
});

/** Lines of text containing `q` (case-insensitive) across the folder's text files. */
export const SearchTextMessage = z.object({
  type: z.literal('searchText'),
  q: z.string(),
  limit: z.number().int().positive().optional(),
  ...envelope,
});

/** Who last changed each line of a file, from git. */
export const BlameMessage = z.object({
  type: z.literal('blame'),
  path: z.string(),
  ...envelope,
});

/** A patch of reader settings for the server to keep. */
export const PreferencesMessage = z.object({
  type: z.literal('preferences'),
  preferences: Preferences,
  ...envelope,
});

/** Where a peer is reading; absent: nowhere. */
export const AtMessage = z.object({ type: z.literal('at'), path: z.string().optional() });

/** The slide the host is on; absent: none. */
export const SlideMessage = z.object({ type: z.literal('slide'), slide: Slide.optional() });

/** The block the host has open full size; absent: none. */
export const StageMessage = z.object({ type: z.literal('stage'), stage: StageRef.optional() });

/** Where a peer's pointer is on the open block; absent: it left. */
export const PointerMessage = z.object({
  type: z.literal('pointer'),
  pointer: PointerAt.optional(),
});

/** A stroke this peer has finished. */
export const InkMessage = z.object({ type: z.literal('ink'), stroke: Stroke });

/** A stroke this peer is still drawing: `points` are those added since its last `inking`
 * frame (its `id` ties the frames together); the finished stroke follows as `ink`. */
export const InkingMessage = z.object({ type: z.literal('inking'), stroke: Stroke });

/** Take back this peer's last stroke on a block. */
export const InkUndoMessage = z.object({
  type: z.literal('inkUndo'),
  docPath: z.string(),
  blockHash: z.string(),
});

/** Wipe this peer's strokes on a block. */
export const InkClearMessage = z.object({
  type: z.literal('inkClear'),
  docPath: z.string(),
  blockHash: z.string(),
});

export const ClientMessage = z.discriminatedUnion('type', [
  HelloMessage,
  ListMessage,
  ReadMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  SearchMessage,
  SearchTextMessage,
  PreferencesMessage,
  BlameMessage,
  AtMessage,
  SlideMessage,
  StageMessage,
  PointerMessage,
  InkMessage,
  InkingMessage,
  InkUndoMessage,
  InkClearMessage,
]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type ListMessage = z.infer<typeof ListMessage>;
export type ReadMessage = z.infer<typeof ReadMessage>;
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessage>;
export type SearchMessage = z.infer<typeof SearchMessage>;
export type SearchTextMessage = z.infer<typeof SearchTextMessage>;
export type PreferencesMessage = z.infer<typeof PreferencesMessage>;
export type BlameMessage = z.infer<typeof BlameMessage>;
export type AtMessage = z.infer<typeof AtMessage>;
export type SlideMessage = z.infer<typeof SlideMessage>;
export type StageMessage = z.infer<typeof StageMessage>;
export type PointerMessage = z.infer<typeof PointerMessage>;
export type InkMessage = z.infer<typeof InkMessage>;
export type InkingMessage = z.infer<typeof InkingMessage>;
export type InkUndoMessage = z.infer<typeof InkUndoMessage>;
export type InkClearMessage = z.infer<typeof InkClearMessage>;
export type ClientMessage = z.infer<typeof ClientMessage>;
export type ClientMessageType = ClientMessage['type'];

export const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[] = ClientMessage.options.map(
  (o) => o.shape.type.value,
);

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessage.parse(input);
}

export function isKnownClientType(type: string): type is ClientMessageType {
  return (CLIENT_MESSAGE_TYPES as readonly string[]).includes(type);
}
