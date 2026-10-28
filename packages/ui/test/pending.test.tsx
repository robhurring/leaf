import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Hold KaTeX until the test releases it, to see each formula's loader first.
const gate = vi.hoisted(() => {
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  return { open, release: () => release() };
});
vi.mock('rehype-katex', async (orig) => {
  await gate.open;
  return orig();
});

const { renderMarkdown } = await import('../src/render/pipeline.js');
const { Markdown } = await import('../src/components/Markdown.js');
const { AssetContext } = await import('../src/render/components/assetContext.js');

const DOC = '# Sums\n\nInline $a+b$ here.\n\n$$\nx^2\n$$\n';

describe('math loads per block', () => {
  it('a render without math marks each formula as loading and keeps its source', async () => {
    const r = await renderMarkdown(DOC, { docPath: 'a.md', config: {}, math: false });
    const { container } = render(r.element);
    const pending = container.querySelectorAll('.leaf-math-pending');
    expect(pending.length).toBe(2);
    expect(pending[0]!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('a+b');
  });

  it('the document shows at once; formulas swap from loader to KaTeX', async () => {
    const { container } = render(<Markdown source={DOC} docPath="a.md" />);
    await waitFor(() => expect(container.querySelector('h1')).toBeTruthy());
    expect(container.querySelectorAll('.leaf-math-pending').length).toBe(2);
    gate.release();
    await waitFor(() => expect(container.querySelector('.katex')).toBeTruthy(), { timeout: 5000 });
    expect(container.querySelector('.leaf-math-pending')).toBeNull();
  });
});

describe('images', () => {
  it('an image whose bytes are still on the way shows a loading placeholder, not an empty pixel', async () => {
    const r = await renderMarkdown('![photo](./p.png)', { docPath: 'a.md', config: {} });
    const { container } = render(
      <AssetContext.Provider value={() => null}>{r.element}</AssetContext.Provider>,
    );
    const ph = container.querySelector('.leaf-image-pending');
    expect(ph).toBeTruthy();
    expect(ph!.getAttribute('aria-label')).toContain('photo');
    expect(container.querySelector('img')).toBeNull();
  });
});
