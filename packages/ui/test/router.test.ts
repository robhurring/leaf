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
