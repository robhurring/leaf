import { describe, it, expect, beforeEach } from 'vitest';
import { useDocuments } from '../src/store/documents.js';
import { scripted } from './helpers/scripted.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const hunk = { start: 1, lines: 2, commit: 'c1', author: 'Rob', date: 1, summary: 's' };

beforeEach(() => useDocuments.getState().reset());

describe('blame in the store', () => {
  it('asks for blame and keeps the answer per path', async () => {
    const s = scripted({ 'a.md': '# a\n' }, { blame: { 'a.md': [hunk] } });
    useDocuments.getState().attach(s.source);
    await flush();
    useDocuments.getState().requestBlame('a.md');
    await flush();
    expect(s.sent.some((m) => m.type === 'blame' && m.path === 'a.md')).toBe(true);
    expect(useDocuments.getState().blame['a.md']).toEqual({
      hunks: [hunk],
      repoUrl: 'https://github.com/rob/leaf',
    });
  });

  it('a change to a file with blame asks again', async () => {
    const s = scripted({ 'a.md': '# a\n' }, { blame: { 'a.md': [hunk] } });
    useDocuments.getState().attach(s.source);
    await flush();
    useDocuments.getState().open('a.md');
    useDocuments.getState().requestBlame('a.md');
    await flush();
    const asked = () => s.sent.filter((m) => m.type === 'blame').length;
    expect(asked()).toBe(1);
    s.emit({ type: 'changed', path: 'a.md', change: 'modified' });
    await flush();
    expect(asked()).toBe(2);
  });
});
