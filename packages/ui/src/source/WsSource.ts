// DocumentSource over a WebSocket. Sends `hello` on every (re)open, queues sends
// while disconnected, and reconnects with backoff. Every couple of seconds (and on
// check(), at each navigation) it asks the server's /healthz: a socket can look open
// long after the server went away, and a server that is back should not wait out
// the backoff.
import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@leaf/protocol';
import { Listeners, type DocumentSource, type SourceStatus } from './DocumentSource.js';

export type WsSourceOptions = {
  WebSocketImpl?: typeof WebSocket;
  backoffMs?: number[];
  /** How often to ask /healthz; 0 turns it off. */
  heartbeatMs?: number;
  fetchImpl?: typeof fetch;
  /** Who this viewer is, sent in every hello (a share's viewer). */
  name?: string;
};

export const DEFAULT_BACKOFF = [500, 1000, 2000];
const HEARTBEAT_MS = 2000;
/** An answer slower than this counts as none. */
const PROBE_TIMEOUT_MS = 1500;

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
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly healthUrl: string;
  private readonly name: string | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private probing = false;
  status: SourceStatus = 'connecting';

  constructor(
    private readonly url: string,
    opts: WsSourceOptions = {},
  ) {
    this.WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
    this.fetchImpl =
      opts.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    this.name = opts.name;
    this.healthUrl = url.replace(/^ws/, 'http').replace(/\/ws$/, '/healthz');
    this.connect();
    const every = opts.heartbeatMs ?? HEARTBEAT_MS;
    if (every > 0 && this.fetchImpl) this.heartbeat = setInterval(() => this.check(), every);
  }

  /** Asks the server whether it is there, and acts on the answer. */
  check(): void {
    if (this.closed || this.probing || !this.fetchImpl) return;
    this.probing = true;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    this.fetchImpl(this.healthUrl, { cache: 'no-store', signal: abort.signal })
      .then((r) => r.ok)
      .catch(() => false)
      .then((up) => {
        clearTimeout(timer);
        this.probing = false;
        if (this.closed) return;
        if (!up && this.status === 'open') this.drop();
        else if (up && this.status === 'reconnecting') this.reconnectNow();
      });
  }

  /** The server is gone though the socket hasn't noticed: let it go and start over. */
  private drop() {
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.scheduleReconnect();
  }

  private reconnectNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.socket && this.socket.readyState === 0) return;
    this.connect();
  }

  private scheduleReconnect() {
    this.setStatus('reconnecting');
    if (this.timer) clearTimeout(this.timer);
    const delay = this.backoff[Math.min(this.attempt, this.backoff.length - 1)] ?? 1000;
    this.attempt++;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(s: SourceStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  private connect() {
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, name: this.name }));
      for (const m of this.queue.splice(0)) socket.send(JSON.stringify(m));
      this.setStatus('open');
    });
    socket.addEventListener('message', (ev) => {
      if (this.socket !== socket) return;
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
      // A socket already let go of (drop, reconnectNow) is not the live one.
      if (this.closed || this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
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
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close();
    this.setStatus('closed');
  }
}
