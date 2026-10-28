import { describe, it, expect, beforeEach } from 'vitest';
import type { ClientMessage, ServerMessage } from '@leaf/protocol';
import { createSource } from '../src/source/createSource.js';
import { useDocuments } from '../src/store/documents.js';
import { useUi } from '../src/store/ui.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function scripted(
  files: Record<string, string>,
  config: Record<string, unknown> = {},
  preferences?: Record<string, unknown>,
) {
  const sent: ClientMessage[] = [];
  const source = createSource({
    handle(msg, emit) {
      sent.push(msg);
      switch (msg.type) {
        case 'hello':
          return emit({
            type: 'welcome',
            protocol: 1,
            root: { kind: 'dir', name: 'x' },
            config,
            capabilities: { watch: true, write: false, collaborate: false },
            participant: { id: 'local', name: 'You' },
            ...(preferences ? { preferences } : {}),
          });
        case 'list': {
          const dir = msg.path ?? '';
          const prefix = dir ? dir + '/' : '';
          const seen = new Set<string>();
          const entries = [];
          for (const p of Object.keys(files)) {
            if (!p.startsWith(prefix)) continue;
            const [head, ...tail] = p.slice(prefix.length).split('/');
            if (!head || seen.has(head)) continue;
            seen.add(head);
            entries.push(
              tail.length
                ? { path: prefix + head, name: head, kind: 'dir' as const, hasChildren: true }
                : { path: p, name: head, kind: 'file' as const },
            );
          }
          return emit({ type: 'tree', path: dir, entries, inReplyTo: msg.id });
        }
        case 'read': {
          const content = files[msg.path];
          if (content === undefined)
            return emit({
              type: 'error',
              code: 'not_found',
              message: 'missing',
              path: msg.path,
              inReplyTo: msg.id,
            });
          return emit({
            type: 'file',
            path: msg.path,
            kind: 'markdown',
            mime: 'text/markdown',
            encoding: 'utf8',
            content,
            url: '/raw/' + msg.path,
            size: content.length,
            mtime: 1,
            inReplyTo: msg.id,
          });
        }
        default:
          return;
      }
    },
  });
  return { source, sent, emit: (m: ServerMessage) => source.push(m), files };
}

beforeEach(() => {
  useDocuments.getState().reset();
});

describe('useDocuments', () => {
  it('welcome triggers the root list and status open', async () => {
    const { source } = scripted({ 'a.md': '# a' });
    useDocuments.getState().attach(source);
    await flush();
    const s = useDocuments.getState();
    expect(s.status).toBe('open');
    expect(s.root).toEqual({ kind: 'dir', name: 'x' });
    expect(s.tree['']?.map((e) => e.path)).toEqual(['a.md']);
  });

  it('open subscribes, reads, and unsubscribes the previous path', async () => {
    const { source, sent } = scripted({ 'a.md': '# a', 'b.md': '# b' });
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().open('a.md');
    await flush();
    expect(
      sent.filter(
        (m) =>
          m.type !== 'hello' && m.type !== 'list' && !(m.type === 'subscribe' && m.path === ''),
      ),
    ).toEqual([
      { type: 'subscribe', path: 'a.md' },
      expect.objectContaining({ type: 'read', path: 'a.md' }),
    ]);
    expect(useDocuments.getState().files['a.md']?.content).toBe('# a');
    useDocuments.getState().open('b.md');
    await flush();
    expect(sent.at(-3)).toEqual({ type: 'unsubscribe', path: 'a.md' });
    expect(useDocuments.getState().path).toBe('b.md');
  });

  it('changed on the open path re-reads once per burst', async () => {
    const { source, sent, emit } = scripted({ 'a.md': '# a' });
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().open('a.md');
    await flush();
    const reads = () => sent.filter((m) => m.type === 'read').length;
    const before = reads();
    emit({ type: 'changed', path: 'a.md', change: 'modified' });
    emit({ type: 'changed', path: 'a.md', change: 'modified' });
    await flush();
    expect(reads()).toBe(before + 1);
  });

  it('deleted open path sets not_found and recovers on created', async () => {
    const { source, emit } = scripted({ 'a.md': '# a' });
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().open('a.md');
    await flush();
    emit({ type: 'changed', path: 'a.md', change: 'deleted' });
    expect(useDocuments.getState().files['a.md']).toBeUndefined();
    expect(useDocuments.getState().errors['a.md']?.code).toBe('not_found');
    emit({ type: 'changed', path: 'a.md', change: 'created' });
    await flush();
    expect(useDocuments.getState().files['a.md']?.content).toBe('# a');
    expect(useDocuments.getState().errors['a.md']).toBeUndefined();
  });

  it('subscribes to the root on welcome so tree changes arrive', async () => {
    const { source, sent } = scripted({ 'a.md': '# a' });
    useDocuments.getState().attach(source);
    await flush();
    expect(sent).toContainEqual({ type: 'subscribe', path: '' });
  });

  it('a created file re-lists its parent when that folder is loaded', async () => {
    const { source, sent, emit, files } = scripted({ 'a.md': '# a', 'docs/b.md': '# b' });
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().expand('docs');
    await flush();
    const lists = () => sent.filter((m) => m.type === 'list' && m.path === 'docs').length;
    const before = lists();
    files['docs/c.md'] = '# c';
    emit({ type: 'changed', path: 'docs/c.md', change: 'created' });
    await flush();
    expect(lists()).toBe(before + 1);
    expect(useDocuments.getState().tree['docs']?.map((e) => e.path)).toContain('docs/c.md');
  });

  it('expandAll walks every level and stops at maxEntries', async () => {
    const deep = { 'a/b/c/d.md': '#', 'a/x.md': '#', 'top.md': '#' };
    const { source } = scripted(deep);
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().expandAll();
    for (let i = 0; i < 5; i++) await flush();
    expect([...useDocuments.getState().expanded].sort()).toEqual(['a', 'a/b', 'a/b/c']);
    expect(useDocuments.getState().expandAllCapped).toBe(false);

    useDocuments.getState().reset();
    const capped = scripted(deep, { maxEntries: 3 });
    useDocuments.getState().attach(capped.source);
    await flush();
    useDocuments.getState().expandAll();
    for (let i = 0; i < 5; i++) await flush();
    expect(useDocuments.getState().expandAllCapped).toBe(true);
    expect(useDocuments.getState().expanded.size).toBeLessThan(3);
  });

  it('error replies are stored by path', async () => {
    const { source } = scripted({});
    useDocuments.getState().attach(source);
    await flush();
    useDocuments.getState().open('nope.md');
    await flush();
    expect(useDocuments.getState().errors['nope.md']?.code).toBe('not_found');
  });
});

describe('preferences sync', () => {
  it('welcome preferences win over local storage, and local changes are sent back', async () => {
    useUi.getState().setAppearance('dark');
    useUi.getState().setNumbering(false);
    const { source, sent } = scripted(
      { 'a.md': '# a' },
      {},
      { appearance: 'light', numbering: true },
    );
    useDocuments.getState().attach(source);
    await flush();
    expect(useUi.getState().appearance).toBe('light');
    expect(useUi.getState().numbering).toBe(true);
    // Applying the server's values must not echo them back.
    expect(sent.filter((m) => m.type === 'preferences')).toEqual([]);
    useUi.getState().setOutlineOpen(false);
    await flush();
    expect(sent.filter((m) => m.type === 'preferences')).toEqual([
      { type: 'preferences', preferences: { outlineOpen: false } },
    ]);
    // Non-preference state (expanded folders) stays local.
    useUi.getState().setExpandedDirs(['docs']);
    await flush();
    expect(sent.filter((m) => m.type === 'preferences')).toHaveLength(1);
  });

  it('without server preferences nothing is sent and local storage still applies', async () => {
    useUi.getState().setTheme('card');
    const { source, sent } = scripted({ 'a.md': '# a' });
    useDocuments.getState().attach(source);
    await flush();
    expect(useUi.getState().theme).toBe('card');
    useUi.getState().setTheme('paper');
    await flush();
    expect(sent.filter((m) => m.type === 'preferences')).toEqual([]);
  });
});

describe('useUi', () => {
  it('persists and clamps text size', () => {
    const ui = useUi.getState();
    for (let i = 0; i < 10; i++) useUi.getState().bumpText(10);
    expect(useUi.getState().textPct).toBe(160);
    useUi.getState().bumpText(0);
    expect(useUi.getState().textPct).toBe(100);
    useUi.getState().setTreeOpen(false);
    expect(JSON.parse(localStorage.getItem('leaf.ui')!).state.treeOpen).toBe(false);
    expect(ui.theme).toBe('github');
    expect(ui.appearance).toBe('auto');
  });
});
