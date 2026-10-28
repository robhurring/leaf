import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsSource } from '../src/source/WsSource.js';
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
  });

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
});
