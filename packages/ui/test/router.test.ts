import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter } from '../src/router.js';

beforeEach(() => history.replaceState(null, '', '/'));

describe('router', () => {
  it('path round trip with base', () => {
    const r = createRouter('/app');
    r.push('docs/a.md', 'setup');
    expect(location.pathname).toBe('/app/docs/a.md');
    expect(location.hash).toBe('#setup');
    expect(r.current()).toEqual({ path: 'docs/a.md', slug: 'setup' });
  });

  it('root', () => {
    const r = createRouter('');
    r.push('');
    expect(location.pathname).toBe('/');
    expect(r.current().path).toBe('');
  });

  it('decodes and encodes spaces', () => {
    const r = createRouter('');
    r.push('my docs/a b.md');
    expect(location.pathname).toBe('/my%20docs/a%20b.md');
    expect(r.current().path).toBe('my docs/a b.md');
  });

  it('subscribe fires on popstate', () => {
    const r = createRouter('');
    const seen: string[] = [];
    r.subscribe((loc) => seen.push(loc.path));
    history.pushState(null, '', '/x.md');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(seen).toEqual(['x.md']);
  });
});

describe('router history', () => {
  // happy-dom's history.back() does not fire popstate; simulate the browser's step.
  const pop = () => window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));

  it('nothing to go back to at the start', () => {
    const r = createRouter('');
    expect(r.canGoBack()).toBe(false);
    expect(r.canGoForward()).toBe(false);
  });

  it('a push can be gone back from, then forward to', () => {
    const r = createRouter('');
    const changes: string[] = [];
    r.onHistory(() => changes.push(`${r.canGoBack()}/${r.canGoForward()}`));
    r.push('a.md');
    r.push('b.md');
    expect(r.canGoBack()).toBe(true);
    history.replaceState({ leaf: 1 }, '', '/a.md');
    pop();
    expect(r.canGoBack()).toBe(true);
    expect(r.canGoForward()).toBe(true);
    history.replaceState({ leaf: 0 }, '', '/');
    pop();
    expect(r.canGoBack()).toBe(false);
    expect(r.canGoForward()).toBe(true);
    expect(changes.at(-1)).toBe('false/true');
  });

  it('a push after going back drops the forward entries', () => {
    const r = createRouter('');
    r.push('a.md');
    r.push('b.md');
    history.replaceState({ leaf: 1 }, '', '/a.md');
    pop();
    r.push('c.md');
    expect(r.canGoForward()).toBe(false);
  });

  it('replace keeps the entry where it is', () => {
    const r = createRouter('');
    r.push('a.md');
    r.replace('a.md', 'setup');
    expect(r.canGoBack()).toBe(true);
    expect(history.state).toEqual({ leaf: 1 });
  });
});
