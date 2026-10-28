// DocumentSource over a WebSocket. Sends `hello` on every (re)open, queues sends
// while disconnected, and reconnects with backoff.
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@leaf/protocol';
import { Listeners, type DocumentSource, type SourceStatus } from './DocumentSource.js';

export type WsSourceOptions = { WebSocketImpl?: typeof WebSocket; backoffMs?: number[] };

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000, 10000];

export class WsSource implements DocumentSource {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private messages = new Listeners<ServerMessage>();
  private statuses = new Listeners<SourceStatus>();
  /** Messages that arrived before anyone listened: the app creates the source at module
   *  load and the store subscribes in an effect, and a fast server answers in between. */
  private backlog: ServerMessage[] = [];
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly backoff: number[];
  status: SourceStatus = 'connecting';

  constructor(
    private readonly url: string,
    opts: WsSourceOptions = {},
  ) {
    this.WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
    this.connect();
  }

  private setStatus(s: SourceStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  private connect() {
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0;
      socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION }));
      for (const m of this.queue.splice(0)) socket.send(JSON.stringify(m));
      this.setStatus('open');
    });
    socket.addEventListener('message', (ev) => {
      let parsed: ServerMessage;
      try {
        parsed = parseServerMessage(JSON.parse(String((ev as MessageEvent).data)));
      } catch (e) {
        console.warn('leaf: dropped unreadable message', e);
        return;
      }
      if (this.messages.size === 0) this.backlog.push(parsed);
      else this.messages.emit(parsed);
    });
    socket.addEventListener('close', () => {
      if (this.closed) return;
      this.setStatus('reconnecting');
      const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 1000;
      this.attempt++;
      this.timer = setTimeout(() => this.connect(), delay);
    });
    socket.addEventListener('error', () => {
      /* the close event follows and drives reconnection */
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  onMessage(handler: (msg: ServerMessage) => void): () => void {
    const off = this.messages.add(handler);
    for (const m of this.backlog.splice(0)) this.messages.emit(m);
    return off;
  }

  onStatus(handler: (status: SourceStatus) => void): () => void {
    const off = this.statuses.add(handler);
    // Replay what the listener missed; 'connecting' is what everyone assumes to start with.
    if (this.status !== 'connecting') handler(this.status);
    return off;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.setStatus('closed');
  }
}
