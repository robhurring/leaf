// Who is where in a share: pure helpers over the relay's presence message.
import type { Peer, PresenceMessage } from '@leaf/protocol';

/** The first letters of the first two words, upper-cased; "?" for no name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.length ? words.map((w) => [...w][0]!.toUpperCase()).join('') : '?';
}

/** Everyone but you who is reading anywhere, the host included. */
function others(p: PresenceMessage | null): (Peer & { path?: string })[] {
  if (!p) return [];
  const host: Peer = { ...p.host, ...(p.hostPath ? { path: p.hostPath } : {}) };
  return [host, ...p.viewers].filter((x) => x.id !== p.you);
}

/** Who is reading this file. */
export function peersOn(p: PresenceMessage | null, path: string): Peer[] {
  return others(p).filter((x) => x.path === path);
}

/** Who is reading something inside this folder. */
export function peersUnder(p: PresenceMessage | null, dir: string): Peer[] {
  return others(p).filter((x) => x.path?.startsWith(dir + '/'));
}
