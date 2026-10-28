// The heavy parts load only for documents that use them, so the first page stays small.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const staticImport = (code: string, mod: string) =>
  new RegExp(`^import[^;]*from ['"]${mod.replace(/[/.]/g, '\\$&')}['"]`, 'm').test(code);

describe('lazy loading', () => {
  it('math, raw html, and yaml are not imported up front by the renderer', () => {
    const pipeline = src('render/pipeline.ts');
    expect(staticImport(pipeline, 'rehype-katex')).toBe(false);
    expect(staticImport(pipeline, 'rehype-raw')).toBe(false);
    expect(staticImport(src('render/plugins/remarkFrontmatterData.ts'), 'yaml')).toBe(false);
    expect(src('styles/leaf.css')).not.toMatch(/@import 'katex/);
  });

  it('the PlantUML encoder is not imported up front', () => {
    expect(staticImport(src('viewers/plantuml/index.tsx'), './encode.js')).toBe(false);
  });

  it('the code editor is not imported up front by the code viewer', () => {
    expect(staticImport(src('viewers/code/index.tsx'), './editor.js')).toBe(false);
  });
});
