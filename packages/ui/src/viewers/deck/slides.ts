// Slides drawn into a shadow root (so a Marp theme can't restyle leaf), one shown at a
// time, sized to fit at the deck's own shape. Shared by the deck and the speaker view.
import { observe as polyfill } from '@marp-team/marpit-svg-polyfill';
import { isAbsoluteUrl, resolveRelative } from '../../render/paths.js';
import type { Deck } from './marp.js';

/** The slide sized to fit the space at its own shape (16:9 unless the deck says), centered. */
const slidesCss = (ratio: number) => `
:host { display: block; }
div.marpit { width: 100%; height: 100%; container-type: size; display: grid; place-items: center; }
div.marpit > svg[data-marpit-svg] { display: none; width: min(100cqw, calc(100cqh * ${ratio})); height: auto;
  box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.10); border-radius: 4px; }
:host([data-presenting]) div.marpit > svg[data-marpit-svg] { box-shadow: none; border-radius: 0; }
`;
export const OVERVIEW_CSS = `
:host { display: block; }
div.marpit { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
div.marpit > svg[data-marpit-svg] { display: block; width: 100%; height: auto; cursor: pointer;
  border-radius: 6px; box-shadow: 0 0 0 1px rgba(127,127,127,.3); }
`;

const ratioOf = (html: string) => {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(html);
  return m ? Number(m[1]) / Number(m[2]) : 16 / 9;
};

/** Fills `host`'s shadow root with the deck; images point at files beside the document.
 *  Returns the root and a function that stops WebKit's scaling polyfill. */
export function mountDeck(
  host: HTMLElement,
  deck: Deck,
  docPath: string,
  resolve: (p: string) => string | null,
  css = slidesCss(ratioOf(deck.html)),
) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><style>${deck.css}</style><style id="leaf-deck-current"></style>${deck.html}`;
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (!src || isAbsoluteUrl(src) || src.startsWith('/') || src.startsWith('data:')) continue;
    const url = resolve(resolveRelative(docPath, src));
    if (url) img.setAttribute('src', url);
  }
  // WebKit (Safari, the app) doesn't scale HTML inside a scaled SVG; Marp's polyfill does.
  return { root, stop: polyfill(root) };
}

/** Shows slide `index` (from 0) of a mounted deck. */
export function showSlide(host: HTMLElement | null, index: number) {
  const current = host?.shadowRoot?.getElementById('leaf-deck-current');
  if (current)
    current.textContent = `div.marpit > svg[data-marpit-svg]:nth-of-type(${index + 1}) { display: block; }`;
}
