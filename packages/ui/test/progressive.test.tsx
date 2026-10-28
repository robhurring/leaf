import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Hold highlighting until the test releases it, to see the document arrive before colors do.
const gate = vi.hoisted(() => {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  return { open, release: () => release() };
});
vi.mock('../src/render/highlight.js', async (orig) => {
  const real = await orig<typeof import('../src/render/highlight.js')>();
  return {
    ...real,
    highlightToHast: async (code: string, lang: string) => {
      await gate.open;
      return real.highlightToHast(code, lang);
    },
  };
});

const { renderMarkdown } = await import('../src/render/pipeline.js');
const { Markdown } = await import('../src/components/Markdown.js');

const DOC = '# Title\n\nSome text.\n\n```ts\nconst a = 1;\n```\n';

describe('progressive highlighting', () => {
  it('a render without highlighting does not wait for the highlighter', async () => {
    const r = await renderMarkdown(DOC, { docPath: 'a.md', config: {}, highlight: false });
    const { container } = render(r.element);
    expect(container.querySelector('h1')!.textContent).toContain('Title');
    expect(container.querySelector('pre.shiki')).toBeNull();
    expect(container.textContent).toContain('const a = 1;');
  });

  it('the document shows at once with plain code, then the highlighted code replaces it', async () => {
    const { container } = render(<Markdown source={DOC} docPath="a.md" />);
    await waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
    expect(container.querySelector('pre.shiki')).toBeNull();
    expect(container.textContent).toContain('const a = 1;');
    gate.release();
    await waitFor(() => expect(container.querySelector('pre.shiki')).toBeTruthy(), {
      timeout: 5000,
    });
  });
});
