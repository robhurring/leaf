// A relay turning this page away at the door: the share is full, or the page speaks
// another protocol than the relay. Said as an error with no path, before any welcome.
import type { ServerMessage } from '@leaf/protocol';

export type Refusal = 'full' | 'outdated';

export function refusalOf(msg: ServerMessage): Refusal | null {
  if (msg.type !== 'error' || msg.path) return null;
  if (/^this share is full/.test(msg.message)) return 'full';
  if (/^this share runs leaf protocol/.test(msg.message)) return 'outdated';
  return null;
}
