import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  return {
    handlers,
    invoke: vi.fn(async () => undefined),
    unlisten: vi.fn(),
    listen: vi.fn(async (name: string, fn: (e: { payload: unknown }) => void) => {
      handlers.set(name, fn);
      return mocks.unlisten;
    }),
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

const { TauriSource, openExternalLinks } = await import('../src/source/TauriSource.js');

const welcome = {
  type: 'welcome',
  protocol: 1,
  root: { kind: 'dir', name: 'x' },
  config: {},
  capabilities: { watch: true, write: false, collaborate: false },
  participant: { id: 'local', name: 'You' },
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mocks.handlers.clear();
  mocks.invoke.mockClear();
  mocks.unlisten.mockClear();
});

describe('TauriSource', () => {
  it('listens on its window channel, says hello, and goes open', async () => {
    const src = new TauriSource('main');
    const statuses: string[] = [];
    src.onStatus((s) => statuses.push(s));
    await flush();
    expect(mocks.listen).toHaveBeenCalledWith('leaf://message/main', expect.any(Function));
    expect(mocks.invoke).toHaveBeenCalledWith('leaf_send', {
      window: 'main',
      msg: { type: 'hello', protocol: 1 },
    });
    expect(statuses).toEqual(['open']);
  });

  it('send invokes leaf_send with the window and message', async () => {
    const src = new TauriSource('w2');
    await flush();
    src.send({ type: 'read', path: 'a.md', id: 'r' });
    expect(mocks.invoke).toHaveBeenLastCalledWith('leaf_send', {
      window: 'w2',
      msg: { type: 'read', path: 'a.md', id: 'r' },
    });
  });

  it('events reach onMessage, garbage is dropped, and early ones are replayed', async () => {
    const src = new TauriSource('main');
    await flush();
    mocks.handlers.get('leaf://message/main')!({ payload: welcome });
    const got: string[] = [];
    src.onMessage((m) => got.push(m.type));
    expect(got).toEqual(['welcome']);
    mocks.handlers.get('leaf://message/main')!({ payload: { type: 'nonsense' } });
    mocks.handlers.get('leaf://message/main')!({ payload: { ...welcome } });
    expect(got).toEqual(['welcome', 'welcome']);
  });

  it('close unlistens and reports closed', async () => {
    const src = new TauriSource('main');
    await flush();
    const statuses: string[] = [];
    src.onStatus((s) => statuses.push(s));
    src.close();
    expect(mocks.unlisten).toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('closed');
  });
});

describe('openExternalLinks', () => {
  it('sends web and mail links to the system browser; in-app links are left alone', () => {
    const stop = openExternalLinks(document);
    document.body.innerHTML = `
      <a id="web" href="https://github.com/rob/leaf/commit/abc" target="_blank"><span id="inner">abc</span></a>
      <a id="mail" href="mailto:a@b.c">mail</a>
      <a id="local" href="/docs/guide.md">guide</a>
      <a id="script" href="javascript:alert(1)">x</a>`;
    mocks.invoke.mockClear();
    const click = (id: string) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(click('inner')).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('leaf_open_url', {
      url: 'https://github.com/rob/leaf/commit/abc',
    });
    expect(click('mail')).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('leaf_open_url', { url: 'mailto:a@b.c' });
    mocks.invoke.mockClear();
    expect(click('local')).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
    stop();
  });

  it('links to other apps (vscode:, cursor:) go to the core, which checks them against Settings', async () => {
    const refused: string[] = [];
    const stop = openExternalLinks(document, (scheme) => refused.push(scheme));
    document.body.innerHTML = `
      <a id="code" href="vscode://file/Users/rob/a.rs:12">a.rs</a>
      <a id="zed" href="zed://file/x">x</a>
      <a id="script" href="javascript:alert(1)">x</a>
      <a id="anchor" href="#setup">setup</a>`;
    const click = (id: string) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(e);
      return e.defaultPrevented;
    };
    mocks.invoke.mockClear();
    expect(click('code')).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith('leaf_open_url', {
      url: 'vscode://file/Users/rob/a.rs:12',
    });
    // The core refuses a kind not in Settings: the page says which.
    mocks.invoke.mockRejectedValueOnce(new Error('not an allowed kind of link'));
    expect(click('zed')).toBe(true);
    await flush();
    expect(refused).toEqual(['zed']);
    // Code-running links stop here; in-page anchors are the page's own.
    mocks.invoke.mockClear();
    expect(click('script')).toBe(true);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(click('anchor')).toBe(false);
    stop();
  });
});
