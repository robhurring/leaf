import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const src = join(__dirname, '..', 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory()
      ? files(p)
      : p.endsWith('.ts') || p.endsWith('.tsx')
        ? [p]
        : [];
  });
}
const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);

describe('layering (spec §7.1)', () => {
  it('render/ never imports anything outside render/ (no viewers, components, stage, store, source)', () => {
    const renderDir = join(src, 'render');
    const bad = files(renderDir).flatMap((f) =>
      importsOf(f)
        .filter((i) => i.startsWith('.'))
        .map((i) => resolve(dirname(f), i))
        .filter((target) => !target.startsWith(renderDir))
        .map((target) => `${f.replace(src, '')} -> ${target.replace(src, '')}`),
    );
    expect(bad).toEqual([]);
  });

  it('nothing outside source/ opens a WebSocket', () => {
    const bad = files(src).filter(
      (f) =>
        !f.includes('/source/') && /new WebSocket\(|WebSocketImpl/.test(readFileSync(f, 'utf8')),
    );
    expect(bad).toEqual([]);
  });
});
