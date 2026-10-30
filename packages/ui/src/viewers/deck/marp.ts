// Marp's own renderer, so a deck looks as it does in VS Code's Marp extension and
// marp-cli: themes, directives, `---` between slides. Loaded the first time a deck is
// shown. Raw HTML stays off, as in Marp; its browser script is left out.
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

export type Deck = {
  /** Every slide, each an <svg data-marpit-svg> inside one div.marpit. */
  html: string;
  css: string;
  /** Each slide's speaker notes, from its comments. */
  notes: string[];
  count: number;
};

type MarpLike = {
  render(md: string): { html: string; css: string; comments: string[][] };
};

let marp: Promise<MarpLike> | null = null;
const loadMarp = () => {
  if (!marp) {
    marp = track(load(() => import('@marp-team/marp-core'))).then(
      ({ Marp }) =>
        new Marp({
          html: false,
          script: false,
          // KaTeX like the rest of leaf, with its fonts from leaf rather than a CDN.
          math: { lib: 'katex', katexFontPath: false },
        }) as unknown as MarpLike,
    );
    marp.catch(() => (marp = null));
  }
  return marp;
};

export async function renderDeck(source: string): Promise<Deck> {
  const m = await loadMarp();
  const { html, css, comments } = m.render(source);
  const clean = html.replace(/<script[\s\S]*?<\/script>/g, '');
  return {
    html: clean,
    css,
    notes: comments.map((c) => c.join('\n\n').trim()),
    count: (clean.match(/data-marpit-svg/g) ?? []).length,
  };
}
