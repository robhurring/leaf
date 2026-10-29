// The frontend's only dependency on the outside world. A source is literally the
// protocol: it accepts client messages and emits server messages. The WebSocket
// client is one implementation; a static site or a host app can supply another.
import type { ClientMessage, ServerMessage } from '@leaf/protocol';

export type SourceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface DocumentSource {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  onStatus(handler: (status: SourceStatus) => void): () => void;
  close(): void;
  /** Confirms the other end is still there (a source that can lose it says so on status). */
  check?(): void;
}

/** Small listener list shared by the source implementations. */
export class Listeners<T> {
  private fns = new Set<(v: T) => void>();
  get size(): number {
    return this.fns.size;
  }
  add(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }
  emit(v: T): void {
    for (const fn of [...this.fns]) fn(v);
  }
}
