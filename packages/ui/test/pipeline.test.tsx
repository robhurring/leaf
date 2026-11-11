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

describe('filterable tables', () => {
  const TABLE = '| name | kind |\n| --- | --- |\n| **logo** | image |\n| notes | text |\n';
  it('a table after <!--table:filter--> gets a filter; others do not', async () => {
    const withIt = renderToStaticMarkup(
      (await renderMarkdown(`<!--table:filter-->\n${TABLE}`, base)).element,
    );
    expect(withIt).toContain('aria-label="Filter rows"');
    expect(withIt).toMatch(/<strong[^>]*>logo<\/strong>/);
    const without = renderToStaticMarkup((await renderMarkdown(TABLE, base)).element);
    expect(without).not.toContain('Filter rows');
  });

  it('typing hides the rows that do not match', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const r = await renderMarkdown(`<!--table:filter-->\n\n${TABLE}`, base);
    const view = render(r.element);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter rows' }), {
      target: { value: 'note' },
    });
    const rows = [...view.container.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows.map((tr) => tr.hidden)).toEqual([true, false]);
    expect(view.container.textContent).toContain('1 of 2 rows');
  });

  it("every table's headers sort its rows and keep the cells' markdown", async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const table =
      '| n | item |\n| --- | --- |\n| 10 | [b](https://x/b) |\n| 9 | **a** |\n| 100 | c |\n';
    const r = await renderMarkdown(table, base);
    const view = render(r.element);
    const heads = [...view.container.querySelectorAll('thead th')] as HTMLElement[];
    expect(heads.map((th) => th.className)).toEqual(['leaf-sortable', 'leaf-sortable']);
    expect(view.container.querySelector('[aria-label="Filter rows"]')).toBeNull();
    const firstCol = () =>
      [...view.container.querySelectorAll('tbody tr')].map((tr) => tr.children[0]?.textContent);
    fireEvent.click(heads[0]!);
    expect(firstCol()).toEqual(['9', '10', '100']);
    expect(heads[0]!.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(heads[0]!);
    expect(firstCol()).toEqual(['100', '10', '9']);
    fireEvent.click(heads[0]!);
    expect(firstCol()).toEqual(['10', '9', '100']);
    expect(view.container.querySelector('tbody a')?.getAttribute('href')).toBe('https://x/b');
    expect(view.container.querySelector('tbody strong')?.textContent).toBe('a');
  });

  it('a row a live edit adds is sorted and counted with the rest', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const head = '<!--table:filter sort-->\n\n| n |\n| --- |\n';
    const view = render((await renderMarkdown(`${head}| 3 |\n| 1 |\n`, base)).element);
    const col = () =>
      [...view.container.querySelectorAll('tbody tr')].map((tr) => tr.textContent?.trim());
    fireEvent.click(view.container.querySelector('thead th')!);
    expect(col()).toEqual(['1', '3']);
    view.rerender((await renderMarkdown(`${head}| 3 |\n| 1 |\n| 2 |\n`, base)).element);
    expect(col()).toEqual(['1', '2', '3']);
    expect(view.container.textContent).toContain('3 rows');
  });

  it('<!--table:sort--> still renders as nothing and adds no filter bar', async () => {
    const html = renderToStaticMarkup(
      (await renderMarkdown(`<!--table:sort-->\n${TABLE}`, base)).element,
    );
    expect(html).not.toContain('Filter rows');
    expect(html).not.toContain('table:sort');
    expect(html).toContain('class="leaf-table"');
  });
});

describe('column widths', () => {
  const TABLE = '| n | item |\n| --- | --- |\n| 2 | b |\n| 1 | a |\n';
  // jsdom lays nothing out: give each header cell and the table a size to start from.
  const sized = (el: Element, width: number) =>
    (el.getBoundingClientRect = () => ({ width }) as DOMRect);
  const drag = (grip: Element, from: number, to: number) => {
    grip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: from }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: to }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: to }));
  };
  const mount = async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const view = render((await renderMarkdown(TABLE, base)).element);
    const table = view.container.querySelector('table')!;
    const heads = [...table.querySelectorAll('thead th')] as HTMLElement[];
    sized(table, 302);
    sized(heads[0]!, 100);
    sized(heads[1]!, 200);
    const grips = heads.map((th) => th.querySelector('.leaf-col-grip')!);
    return { view, table, heads, grips, fireEvent };
  };

  it('dragging a header edge widens that column and the table, and leaves the others', async () => {
    const { table, heads, grips } = await mount();
    drag(grips[0]!, 100, 160);
    expect(heads.map((th) => th.style.width)).toEqual(['160px', '200px']);
    expect(table.style.width).toBe('362px');
    expect(table.dataset.sized).toBe('');
    drag(grips[0]!, 160, -500);
    expect(heads[0]!.style.width).toBe('60px');
    expect(table.style.width).toBe('262px');
  });

  it("a drag that ends near the page's edge lands on it", async () => {
    const { table, heads, grips } = await mount();
    Object.defineProperty(table.parentElement!, 'clientWidth', { value: 400 });
    drag(grips[1]!, 300, 392);
    expect(table.style.width).toBe('400px');
    expect(heads[1]!.style.width).toBe('298px');
    drag(grips[1]!, 392, 450);
    expect(table.style.width).toBe('458px');
  });

  it('a click or a drag on the edge does not sort', async () => {
    const { view, heads, grips, fireEvent } = await mount();
    drag(grips[0]!, 100, 160);
    fireEvent.click(grips[0]!);
    expect(heads[0]!.getAttribute('aria-sort')).toBe('none');
    expect(view.container.querySelector('tbody td')?.textContent).toBe('2');
  });

  it('a click on the edge puts that column back, and the table lays itself out again', async () => {
    const { table, heads, grips, fireEvent } = await mount();
    drag(grips[0]!, 100, 160);
    drag(grips[1]!, 300, 350);
    // The click that ends a drag is swallowed; a click a moment later is a click.
    await new Promise((r) => setTimeout(r));
    fireEvent.click(grips[0]!);
    expect(heads.map((th) => th.style.width)).toEqual(['100px', '250px']);
    expect(heads[0]!.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(grips[1]!);
    expect(heads.map((th) => th.style.width)).toEqual(['', '']);
    expect(table.style.width).toBe('');
    expect(table.dataset.sized).toBeUndefined();
  });

  it('a double-click fits the column to what it holds', async () => {
    const { table, heads, grips, fireEvent } = await mount();
    drag(grips[0]!, 100, 160);
    // What the column measures with the table laid out freely.
    sized(heads[0]!, 130);
    fireEvent.doubleClick(grips[0]!);
    expect(heads.map((th) => th.style.width)).toEqual(['130px', '200px']);
    expect(table.style.width).toBe('332px');
    expect(table.dataset.sized).toBe('');
  });

  it('widths survive a live edit to the rows and start over when the columns change', async () => {
    const { view, table, heads, grips } = await mount();
    drag(grips[1]!, 300, 340);
    view.rerender((await renderMarkdown(`${TABLE}| 3 | c |\n`, base)).element);
    expect(heads[1]!.style.width).toBe('240px');
    view.rerender(
      (await renderMarkdown('| n | item | more |\n| --- | --- | --- |\n| 2 | b | x |\n', base))
        .element,
    );
    expect(table.dataset.sized).toBeUndefined();
    expect(table.querySelectorAll('.leaf-col-grip')).toHaveLength(3);
  });
});
