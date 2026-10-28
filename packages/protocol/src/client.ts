import { z } from 'zod';
import { PROTOCOL_VERSION, Preferences, envelope } from './common.js';

export const HelloMessage = z.object({
  type: z.literal('hello'),
  protocol: z.literal(PROTOCOL_VERSION),
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

/** A patch of reader settings for the server to keep. */
export const PreferencesMessage = z.object({
  type: z.literal('preferences'),
  preferences: Preferences,
  ...envelope,
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
]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type ListMessage = z.infer<typeof ListMessage>;
export type ReadMessage = z.infer<typeof ReadMessage>;
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessage>;
export type SearchMessage = z.infer<typeof SearchMessage>;
export type SearchTextMessage = z.infer<typeof SearchTextMessage>;
export type PreferencesMessage = z.infer<typeof PreferencesMessage>;
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
