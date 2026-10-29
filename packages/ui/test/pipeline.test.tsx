import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown, extractHeadings, type RenderOptions } from '../src/render/pipeline.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', 'fixtures', `${name}.md`), 'utf8');
const base: RenderOptions = { docPath: 'README.md', config: {} };
const render = (name: string, opts: Partial<RenderOptions> = {}) =>
  renderMarkdown(fixture(name), { ...base, ...opts });
const html = async (name: string, opts: Partial<RenderOptions> = {}) =>
  renderToStaticMarkup((await render(name, opts)).element);

describe('renderMarkdown', () => {
  it('gfm table, task list, strikethrough, footnote, autolink', async () => {
    const h = await html('gfm');
    expect(h).toContain('<table');
    expect(h).toMatch(/<th[^>]*align="center"|text-align:\s*center/);
    expect(h).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(h).toMatch(/<del[^>]*>Removed<\/del>/);
    expect(h).toContain('footnote body');
    expect(h).toContain('href="https://example.com"');
    expect(h).toContain('🎉');
  });

  it('duplicate headings get -1 and the outline matches', async () => {
    const r = await render('headings');
    const h = renderToStaticMarkup(r.element);
    expect(h).toContain('id="setup"');
    expect(h).toContain('id="setup-1"');
    expect(h).toContain('id="whats-new-v2"');
    expect(r.headings.map((x) => x.slug)).toEqual([
      'headings',
      'setup',
      'setup-1',
      'whats-new-v2',
      'deeper',
      'deepest',
    ]);
    expect(r.headings[1]).toMatchObject({ depth: 2, text: 'Setup', line: 3 });
    expect(extractHeadings(fixture('headings')).map((x) => x.slug)).toEqual(
      r.headings.map((x) => x.slug),
    );
  });

  it('code block is highlighted with a lang label', async () => {
    const h = await html('code');
    expect(h).toContain('data-lang="typescript"');
    expect(h).toContain('class="shiki');
    expect(h).toContain('data-lang="python"');
  });

  it('code block without language renders plain', async () => {
    const h = await html('code');
    expect(h).toMatch(/data-lang="text"[\s\S]*no language here/);
  });

  it('mention and topic, not inside code, links, or emails', async () => {
    const h = await html('inline');
    expect(h).toContain('class="leaf-mention"');
    expect(h).toContain('class="leaf-topic"');
    expect(h).toContain('>@notamention<');
    expect(h).not.toContain('a<span');
    expect(h).toContain('a@b.com');
    expect(h).toMatch(/<a[^>]*>link to @someone<\/a>/);
    expect(h).not.toContain('@alsonotamention<');
  });

  it('mention url template from config', async () => {
    const h = await html('inline', { config: { mentionUrl: 'https://x.com/{username}' } });
    expect(h).toContain('href="https://x.com/rob"');
  });

  it('handlers.onMention wins over config', async () => {
    const h = await html('inline', {
      config: { mentionUrl: 'https://x.com/{username}' },
      handlers: { onMention: (u) => ({ href: `/people/${u}`, label: `~${u}` }) },
    });
    expect(h).toContain('href="/people/rob"');
    expect(h).toContain('~rob');
  });

  it('relative links and images resolve against the doc dir', async () => {
    const h = await html('links', { docPath: 'docs/a.md' });
    expect(h).toContain('data-nav="docs/guide.md"');
    expect(h).toContain('data-nav="up.md"');
    expect(h).toContain('href="#setup"');
    expect(h).toContain('src="/raw/docs/img.png"');
    expect(h).toContain('src="https://example.com/pic.png"');
    expect(h).toMatch(/href="https:\/\/x.com"[^>]*target="_blank"/);
    expect(h).toContain('href="mailto:a@b.com"');
  });

  it('relative links to any file navigate in-app and odd percent signs do not throw', async () => {
    const r = await renderMarkdown('[notes](./notes.txt) [sale](./50%-off.md) [img](./pic.png)', {
      docPath: 'docs/a.md',
      config: {},
    });
    const h = renderToStaticMarkup(r.element);
    expect(h).toContain('data-nav="docs/notes.txt"');
    expect(h).toContain('data-nav="docs/50%-off.md"');
    expect(h).toContain('data-nav="docs/pic.png"');
  });

  it('handlers.resolveLink wins', async () => {
    const h = await html('links', {
      docPath: 'docs/a.md',
      handlers: { resolveLink: (href) => ({ external: `https://host/${href}` }) },
    });
    expect(h).toContain('href="https://host/./guide.md"');
  });

  it('alerts', async () => {
    const h = await html('alerts');
    for (const t of ['note', 'tip', 'important', 'warning', 'caution'])
      expect(h).toContain(`class="leaf-alert leaf-alert-${t}"`);
    expect(h).toContain('leaf-alert-title');
    expect(h).toMatch(/<blockquote[^>]*>[\s\S]*Not an alert/);
  });

  it('math', async () => {
    const h = await html('math');
    expect(h).toContain('class="katex');
    expect(h).toContain('katex-display');
  });

  it('frontmatter is parsed and removed', async () => {
    const r = await render('frontmatter');
    expect(r.frontmatter).toMatchObject({ title: 'Doc', tags: ['a', 'b'] });
    expect(renderToStaticMarkup(r.element)).not.toContain('title: Doc');
  });

  it('html passthrough is sanitized', async () => {
    const h = await html('html');
    expect(h).toContain('<details');
    expect(h).toContain('<summary');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('onerror');
  });

  it('data-pos on blocks', async () =>
    expect(await html('gfm')).toMatch(/data-pos="\d+:\d+-\d+:\d+"/));

  it('handlers.renderBlock wins', async () => {
    const h = await html('code', {
      handlers: {
        renderBlock: (lang) => (lang === 'typescript' ? <div id="custom" /> : undefined),
      },
    });
    expect(h).toContain('id="custom"');
    expect(h).toContain('data-lang="python"');
  });

  it('handlers.onUnknownBlock receives unregistered languages', async () => {
    const h = await html('code', {
      handlers: {
        onUnknownBlock: (lang) => (lang === 'python' ? <div id="unknown" /> : undefined),
      },
    });
    expect(h).toContain('id="unknown"');
    expect(h).toContain('data-lang="typescript"');
  });
});

describe('re-rendering a document', () => {
  it('keeps a rendered block mounted when only other text changes', async () => {
    const { createBlockRegistry } = await import('../src/render/registries/index.js');
    const { render: mount } = await import('@testing-library/react');
    const { createElement, useEffect } = await import('react');
    let mounts = 0;
    function Probe() {
      useEffect(() => {
        mounts++;
      }, []);
      return createElement('div', { 'data-testid': 'probe' });
    }
    const blocks = createBlockRegistry();
    blocks.register({ lang: 'probe', render: () => createElement(Probe) });
    const doc = (title: string) => `# ${title}\n\n\`\`\`probe\nx\n\`\`\`\n`;
    const first = await renderMarkdown(doc('One'), { ...base, registries: { blocks } });
    const second = await renderMarkdown(doc('Two'), { ...base, registries: { blocks } });
    const view = mount(first.element);
    view.rerender(second.element);
    expect(view.container.textContent).toContain('Two');
    expect(mounts).toBe(1);
  });
});
