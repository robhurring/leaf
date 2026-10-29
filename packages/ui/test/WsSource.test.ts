import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_BACKOFF, WsSource } from '../src/source/WsSource.js';
import type { SourceStatus } from '../src/source/DocumentSource.js';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  message(obj: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', { data: typeof obj === 'string' ? obj : JSON.stringify(obj) }),
    );
  }
}

const welcome = {
  type: 'welcome',
  protocol: 1,
  root: { kind: 'dir', name: 'x' },
  config: {},
  capabilities: { watch: true, write: false, collaborate: false },
  participant: { id: 'local', name: 'You' },
};

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const make = () =>
  new WsSource('ws://x/ws', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    backoffMs: [10, 20],
    heartbeatMs: 0,
  });

/** A source whose /healthz answers as `up()` says. */
function probed(up: () => boolean) {
  const fetchImpl = vi.fn(async (url: string) => {
    if (!up()) throw new TypeError('Failed to fetch');
    return new Response('ok');
  });
  const src = new WsSource('ws://x/ws', {
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    backoffMs: [5000],
    heartbeatMs: 2000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { src, fetchImpl };
}

describe('WsSource', () => {
  it('sends hello on open and flushes the queue', () => {
    const src = make();
    src.send({ type: 'list' });
    const s = FakeWebSocket.instances[0]!;
    expect(s.sent).toEqual([]);
    s.open();
    expect(s.sent.map((x) => JSON.parse(x))).toEqual([
      { type: 'hello', protocol: 1 },
      { type: 'list' },
    ]);
  });

  it('reconnects with backoff and re-hellos', () => {
    const src = make();
    const statuses: SourceStatus[] = [];
    src.onStatus((s) => statuses.push(s));
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.close();
    expect(statuses).toEqual(['open', 'reconnecting']);
    vi.advanceTimersByTime(10);
    expect(FakeWebSocket.instances.length).toBe(2);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(JSON.parse(second.sent[0]!)).toEqual({ type: 'hello', protocol: 1 });
    expect(statuses.at(-1)).toBe('open');
    second.close();
    vi.advanceTimersByTime(20);
    expect(FakeWebSocket.instances.length).toBe(3);
  });

  it('parses inbound messages and drops garbage', () => {
    const src = make();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    src.onMessage((m) => seen.push(m));
    const s = FakeWebSocket.instances[0]!;
    s.open();
    s.message(welcome);
    s.message('{bad');
    s.message({ type: 'nope' });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { type: string }).type).toBe('welcome');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('close stops reconnecting', () => {
    const src = make();
    FakeWebSocket.instances[0]!.open();
    src.close();
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('messages and status that arrive before anyone listens are replayed on attach', () => {
    // The app creates the source at module load and the store subscribes in an effect;
    // a fast server answers hello in between. Nothing may be lost in that gap.
    const src = make();
    const s = FakeWebSocket.instances[0]!;
    s.open();
    s.message(welcome);
    s.message({ type: 'tree', path: '', entries: [] });
    const got: unknown[] = [];
    src.onMessage((m) => got.push(m.type));
    expect(got).toEqual(['welcome', 'tree']);
    const statuses: SourceStatus[] = [];
    src.onStatus((st) => statuses.push(st));
    expect(statuses).toEqual(['open']);
    // Later messages flow live, once each.
    s.message({ type: 'tree', path: 'docs', entries: [] });
    expect(got).toEqual(['welcome', 'tree', 'tree']);
  });

  it('polls the server every 2s and notices it gone even while the socket looks open', async () => {
    let up = true;
    const { src, fetchImpl } = probed(() => up);
    const seen: SourceStatus[] = [];
    src.onStatus((st) => seen.push(st));
    FakeWebSocket.instances[0]!.open();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl).toHaveBeenCalledWith('http://x/healthz', expect.anything());
    expect(src.status).toBe('open');
    up = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(src.status).toBe('reconnecting');
    src.close();
  });

  it('while reconnecting, a check that finds the server reconnects without waiting out the backoff', async () => {
    let up = false;
    const { src } = probed(() => up);
    FakeWebSocket.instances[0]!.close();
    expect(src.status).toBe('reconnecting');
    const before = FakeWebSocket.instances.length;
    up = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
    src.close();
  });

  it('check() asks at once, for a navigation', async () => {
    const { src, fetchImpl } = probed(() => false);
    FakeWebSocket.instances[0]!.open();
    src.check();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(src.status).toBe('reconnecting');
    src.close();
  });

  it('a slow answer counts as no answer', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted'))),
        ),
    );
    const src = new WsSource('ws://x/ws', {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      backoffMs: [5000],
      heartbeatMs: 2000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    FakeWebSocket.instances[0]!.open();
    src.check();
    await vi.advanceTimersByTimeAsync(1999);
    expect(src.status).toBe('reconnecting');
    src.close();
  });

  it('the default backoff never waits more than 2s between tries', () => {
    expect(Math.max(...DEFAULT_BACKOFF)).toBeLessThanOrEqual(2000);
  });
});
