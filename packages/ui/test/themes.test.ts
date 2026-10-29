import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_TOKENS, DOC_TOKENS } from '../src/styles/tokens.js';
import { THEMES } from '../src/store/ui.js';

const styles = join(__dirname, '..', 'src', 'styles');
const css = (t: string) => readFileSync(join(styles, 'themes', `${t}.css`), 'utf8');
const base = readFileSync(join(styles, 'leaf.css'), 'utf8');

function block(source: string, selector: string): string {
  const i = source.indexOf(selector);
  if (i < 0) return '';
  return source.slice(i, source.indexOf('}', i));
}

describe('themes', () => {
  it('there are four, github first as the default', () => {
    expect([...THEMES]).toEqual(['github', 'glass', 'card', 'paper']);
  });

  it.each([...THEMES])(
    '%s defines every document token for light and dark, and no chrome token',
    (t) => {
      const source = css(t);
      const light = block(source, `[data-theme='${t}'] {`);
      const dark = block(source, `[data-theme='${t}'][data-appearance='dark'] {`);
      expect(light).not.toBe('');
      expect(dark).not.toBe('');
      for (const token of DOC_TOKENS)
        expect(light, `${t} light missing ${token}`).toContain(`${token}:`);
      for (const token of DOC_TOKENS) {
        // Structural tokens (fonts, sizes) need not repeat in dark; colors must.
        if (/(font|mono|size|leading|measure|pad|radius|weight|shadow)$/.test(token)) continue;
        expect(dark, `${t} dark missing ${token}`).toContain(`${token}:`);
      }
      for (const token of CHROME_TOKENS)
        expect(source, `${t} must not set chrome token ${token}`).not.toContain(`${token}:`);
    },
  );

  it('the chrome is defined once, in the base stylesheet, for light and dark', () => {
    const light = block(base, ':root {');
    const dark = block(base, "[data-appearance='dark'] {");
    for (const token of CHROME_TOKENS)
      expect(light, `base missing ${token}`).toContain(`${token}:`);
    for (const token of CHROME_TOKENS) {
      if (/(font-ui|font-mono|radius|radius-sm|bar-h|sidebar-w)$/.test(token)) continue;
      expect(dark, `base dark missing ${token}`).toContain(`${token}:`);
    }
  });

  it('the document column remaps the generic tokens to the document tokens', () => {
    const main = block(base, '.leaf-doc-col {');
    for (const pair of [
      ['--leaf-text', '--leaf-doc-text'],
      ['--leaf-accent', '--leaf-doc-link'],
      ['--leaf-code-bg', '--leaf-doc-code-bg'],
      ['--leaf-block-bg', '--leaf-doc-block-bg'],
      ['--leaf-radius', '--leaf-doc-radius'],
      ['--leaf-font-mono', '--leaf-doc-mono'],
    ])
      expect(main).toContain(`${pair[0]}: var(${pair[1]})`);
  });

  it('inline-code styling never reaches code inside a code block', () => {
    // Shiki's <code> is inline: a background there becomes a box per line.
    for (const t of ['github', 'glass', 'card', 'paper', 'native']) {
      const source = css(t);
      expect(source, `${t} styles every <code>`).not.toMatch(/\.leaf-doc code\s*\{/);
    }
  });

  it('markdown-table styling never reaches the CSV table', () => {
    // A CSV block is its own table; theme cell borders on top of it doubled every line.
    for (const t of ['github', 'native']) {
      expect(css(t), `${t} styles every table`).not.toMatch(/\.leaf-doc (table|th|td)[,\s{]/);
    }
  });

  it('diagrams are centered', () => {
    expect(base).toMatch(/\.leaf-diagram \{[^}]*justify-content: center/);
  });

  it('the CSV block leaves room for its language label above the filter', () => {
    expect(base).toMatch(/\.leaf-frame\[data-viewer='csv'\] \.leaf-datatable \{[^}]*padding/);
  });

  it('the document fills its column and grows with the window: no measure caps it', () => {
    expect(base).not.toMatch(/\.leaf-main-inner[^{]*\{[^}]*max-width: (?!none)/);
    expect(base).not.toMatch(/--leaf-doc-measure/);
  });

  it('in the app window the chrome behaves like a Mac app, not a page', () => {
    const native = base.slice(base.indexOf('/* ---------- app window ---------- */'));
    expect(native.length).toBeGreaterThan(100);
    // Arrow cursor on controls, chrome text not selectable, no rubber-band on the page.
    expect(native).toMatch(/cursor: default/);
    expect(native).toMatch(/user-select: none/);
    expect(native).toMatch(/overscroll-behavior: none/);
  });

  it('the app keeps macOS overlay scrollbars (custom ones are always visible)', () => {
    expect(base).not.toMatch(/data-shell='app'\][^{]*::-webkit-scrollbar/);
  });

  it('the file header is fixed above the scrolling document; code fills the area like an editor', () => {
    expect(base).not.toContain('.leaf-status');
    expect(block(base, '.leaf-doc-col {')).toContain('flex-direction: column');
    expect(block(base, '.leaf-main {')).toContain('overflow: auto');
    expect(base).toContain(".leaf-main-inner[data-viewer='code'],");
    const code = block(base, ".leaf-main-inner[data-viewer='csv'] {");
    expect(code).toContain('max-width: none');
    expect(code).toContain('padding: 0');
  });
  it('sidebars slide in and out, cast a soft shadow, and stop moving under reduced motion', () => {
    expect(block(base, '.leaf-body {')).toContain('transition: grid-template-columns');
    expect(base).toMatch(/@keyframes leaf-slide-in/);
    expect(block(base, '.leaf-tree {')).toContain('box-shadow');
    expect(base).toMatch(/prefers-reduced-motion: reduce\)[^]*\.leaf-body[^]*transition: none/);
  });

  it('sidebar widths come from the stored values and the handles resize columns', () => {
    expect(block(base, '.leaf-app {')).toContain('--leaf-tree-col: var(--leaf-tree-w');
    expect(block(base, '.leaf-resizer {')).toContain('cursor: col-resize');
  });

  it('the outline sits on the page color, not gray on gray, with the current heading in accent', () => {
    expect(block(base, '.leaf-outline {')).toContain('background: var(--leaf-doc-bg)');
    expect(block(base, '.leaf-outline-current > a {')).toContain('var(--leaf-accent)');
    expect(block(base, '.leaf-outline-current > a {')).toContain(
      'background: var(--leaf-accent-soft)',
    );
    expect(block(base, '.leaf-outline-current > a {')).not.toContain('box-shadow');
  });
  it('find floats over the document; its highlight colors live in find.ts', () => {
    expect(base).not.toContain('::highlight');
    expect(block(base, '.leaf-find {')).toContain('position: absolute');
  });
  it('go to drops its results down from the title bar field, not a centered dialog', () => {
    expect(base).not.toContain('.leaf-palette');
    expect(block(base, '.leaf-goto-list {')).toContain('position: absolute');
    expect(block(base, '.leaf-goto-list {')).toContain('top: calc(100% + 6px)');
  });
  it('heading anchor links are hidden in the app window, which has no address to copy', () => {
    expect(block(base, "html[data-shell='app'] .leaf-anchor {")).toContain('display: none');
  });
  it('blocks never show a border; code keeps a small language label, diagrams none', () => {
    expect(block(base, '.leaf-block {')).toContain('border: 0');
    expect(base).not.toMatch(/\.leaf-block:hover \{[^}]*border-color/);
    expect(block(base, '.leaf-codeblock .leaf-block-lang {')).toContain('opacity: 1');
    expect(block(base, '.leaf-block-lang {')).toContain('opacity: 0');
  });

  it('a whole-file frame fills the column and centers its picture', () => {
    const full = block(base, '.leaf-frame[data-full] {');
    expect(full).toContain('border: 0');
    expect(full).toContain('min-height: 100%');
  });
  it('frame tools moved into the file header are always visible', () => {
    expect(block(base, '.leaf-dochead-tools .leaf-block-tools {')).toContain('opacity: 1');
    expect(block(base, '.leaf-dochead-tools .leaf-block-tools {')).toContain('position: static');
  });
  it('an inline Stage fills the panel; its toolbox sits flat in the toolbar line', () => {
    expect(block(base, '.leaf-stage-inline {')).toContain('flex: 1');
    const tb = block(base, '.leaf-dochead-tools .leaf-toolbox {');
    expect(tb).toContain('position: static');
    expect(tb).toContain('box-shadow: none');
  });
  it.each([...THEMES, 'native'])(
    '%s gives blocks a fill, since blocks have no border to show their extent',
    (theme) => {
      expect(css(theme)).not.toMatch(/--leaf-doc-block-bg: transparent/);
    },
  );
});
