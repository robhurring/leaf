import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Reader } from '../src/components/Reader.js';
import { WsSource } from '../src/source/WsSource.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted, README } from './helpers/scripted.js';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
});

const V2 = README.replace('Intro with', 'Changed intro with');

describe('live updates', () => {
  it('changed re-renders the content and keeps the scroll position', async () => {
    const s = scripted({ 'README.md': README });
    render(<Reader source={s.source} />);
    await screen.findByText(/Intro with/);
    const main = screen.getByRole('main');
    main.scrollTop = 400;
    s.files['README.md'] = V2;
    s.emit({ type: 'changed', path: 'README.md', change: 'modified' });
    await screen.findByText(/Changed intro with/);
    expect(main.scrollTop).toBe(400);
  });

  it('an unchanged block keeps its DOM node across a re-render', async () => {
    const withCode = README + '\n```ts\nconst a = 1\n```\n';
    const s = scripted({ 'README.md': withCode });
    render(<Reader source={s.source} />);
    await waitFor(() => expect(document.querySelector('.leaf-codeblock')).toBeTruthy());
    const before = document.querySelector('.leaf-codeblock');
    s.files['README.md'] = withCode.replace('Intro with', 'Changed intro with');
    s.emit({ type: 'changed', path: 'README.md', change: 'modified' });
    await screen.findByText(/Changed intro with/);
    expect(document.querySelector('.leaf-codeblock')).toBe(before);
  });

  it('deleted shows a removed state and recovers when the file comes back', async () => {
    const s = scripted({ 'README.md': README });
    render(<Reader source={s.source} />);
    await screen.findByRole('heading', { level: 1 });
    s.emit({ type: 'changed', path: 'README.md', change: 'deleted' });
    expect((await screen.findByRole('status', { name: '' })).textContent).toMatch(/removed/i);
    s.emit({ type: 'changed', path: 'README.md', change: 'created' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeTruthy();
  });

  it('scrolls to the url hash once, not on every live re-render', async () => {
    history.replaceState(null, '', '/README.md#setup-1');
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView');
    const s = scripted({ 'README.md': README });
    render(<Reader source={s.source} />);
    await screen.findByText(/Intro with/);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const after = spy.mock.calls.length;
    expect(after).toBeGreaterThanOrEqual(1);
    s.files['README.md'] = V2;
    s.emit({ type: 'changed', path: 'README.md', change: 'modified' });
    await screen.findByText(/Changed intro with/);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(spy.mock.calls.length).toBe(after);
    spy.mockRestore();
  });

  it('five rapid changed messages cause one read', async () => {
    const s = scripted({ 'README.md': README });
    render(<Reader source={s.source} />);
    await screen.findByRole('heading', { level: 1 });
    const reads = () => s.sent.filter((m) => m.type === 'read').length;
    const before = reads();
    for (let i = 0; i < 5; i++) s.emit({ type: 'changed', path: 'README.md', change: 'modified' });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads()).toBe(before + 1);
  });

  it('reconnect re-hellos, re-subscribes, and re-reads the open document', async () => {
    class FakeWebSocket extends EventTarget {
      static instances: FakeWebSocket[] = [];
      readyState = 0;
      sent: string[] = [];
      constructor(public url: string) {
        super();
        FakeWebSocket.instances.push(this);
        setTimeout(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }
      send(d: string) {
        this.sent.push(d);
        const msg = JSON.parse(d) as { type: string; id?: string; path?: string };
        const reply = (m: unknown) =>
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) }));
        if (msg.type === 'hello')
          reply({
            type: 'welcome',
            protocol: 1,
            root: { kind: 'dir', name: 'x' },
            config: {},
            capabilities: { watch: true, write: false, collaborate: false },
            participant: { id: 'local', name: 'You' },
          });
        if (msg.type === 'list')
          reply({
            type: 'tree',
            path: '',
            entries: [
              { path: 'README.md', name: 'README.md', kind: 'file' },
              { path: 'b.md', name: 'b.md', kind: 'file' },
            ],
            inReplyTo: msg.id,
          });
        if (msg.type === 'read')
          reply({
            type: 'file',
            path: msg.path,
            kind: 'markdown',
            mime: 'text/markdown',
            encoding: 'utf8',
            content: README,
            url: '/raw/' + msg.path,
            size: 1,
            mtime: 1,
            inReplyTo: msg.id,
          });
      }
      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }
    const source = new WsSource('ws://x/ws', {
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      backoffMs: [10],
    });
    render(<Reader source={source} />);
    await screen.findByRole('heading', { level: 1 });
    const first = FakeWebSocket.instances[0]!;
    first.close();
    expect(await screen.findByRole('status', { name: /reconnecting/i })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const second = FakeWebSocket.instances[1]!;
    await waitFor(() => expect(second.sent.length).toBeGreaterThanOrEqual(4));
    const types = second.sent.map((f) => JSON.parse(f) as { type: string; path?: string });
    expect(types[0]).toMatchObject({ type: 'hello' });
    expect(types).toContainEqual(expect.objectContaining({ type: 'subscribe', path: 'README.md' }));
    expect(types).toContainEqual(expect.objectContaining({ type: 'read', path: 'README.md' }));
    expect(types).toContainEqual(expect.objectContaining({ type: 'list' }));
    expect(await screen.findByRole('status', { name: /connected/i })).toBeTruthy();
    source.close();
  });
});
