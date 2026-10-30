// A Marp deck, one slide at a time. Slides render into a shadow root so a Marp theme
// can't restyle leaf. Full: arrows, space, Home/End, an overview of every slide, and
// Present (the slide fills the window). Mini, in a document: previous and next.
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { AssetContext, rawUrl } from '../../render/components/assetContext.js';
import { Markdown } from '../../components/Markdown.js';
import { renderDeck, type Deck } from './marp.js';
import { OVERVIEW_CSS, mountDeck, showSlide } from './slides.js';
import { deckChannel, openSpeaker } from './sync.js';

type Props = ViewerProps & { mode: 'full' | 'mini' };

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export default function DeckView(props: Props) {
  const { mode, docPath } = props;
  const code = props.content ?? '';
  const resolve = useContext(AssetContext) ?? rawUrl;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const [presenting, setPresenting] = useState(false);
  // The slide's speaker notes under it (Marp's comment notes), unless switched off.
  const [showNotes, setShowNotes] = useState(true);
  const slides = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    renderDeck(code).then(
      (d) => {
        if (!live) return;
        setDeck(d);
        setError(null);
      },
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [code]);

  const count = deck?.count ?? 0;
  const at = Math.min(index, Math.max(0, count - 1));
  const go = (i: number) => setIndex(Math.max(0, Math.min(count - 1, i)));

  // WebKit (Safari, the app) doesn't scale HTML inside a scaled SVG; Marp's polyfill does.
  useLayoutEffect(() => {
    if (!deck || !slides.current) return;
    return mountDeck(slides.current, deck, docPath, resolve).stop;
  }, [deck, docPath, resolve]);
  useLayoutEffect(() => showSlide(slides.current, at), [deck, at, overview]);

  // A whole deck stays on the same slide as its speaker window, both ways.
  const channel = useRef<ReturnType<typeof deckChannel> | null>(null);
  useEffect(() => {
    if (mode !== 'full') return;
    const c = deckChannel(docPath, setIndex);
    channel.current = c;
    return () => {
      c.close();
      channel.current = null;
    };
  }, [mode, docPath]);
  useEffect(() => channel.current?.post(at), [at]);
  useLayoutEffect(() => {
    if (!overview || !deck || !grid.current) return;
    const { root, stop } = mountDeck(grid.current, deck, docPath, resolve, OVERVIEW_CSS);
    const svgs = [...root.querySelectorAll('svg[data-marpit-svg]')];
    svgs.forEach((svg, i) =>
      svg.addEventListener('click', () => {
        setIndex(i);
        setOverview(false);
      }),
    );
    return stop;
  }, [overview, deck, docPath, resolve]);

  const stopPresenting = () => {
    setPresenting(false);
    if (typeof document !== 'undefined' && document.fullscreenElement)
      void document.exitFullscreen?.().catch(() => {});
  };
  const present = () => {
    setOverview(false);
    setPresenting(true);
    void box.current?.requestFullscreen?.().catch(() => {});
  };

  // The whole-file deck takes the arrow keys, space, and Home/End; a deck in a
  // document only when it has focus, so the page around it still scrolls.
  const onKey = (e: KeyboardEvent | React.KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key);
    const prev = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key);
    if (next) go(at + 1);
    else if (prev) go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(count - 1);
    else if (e.key === 'Escape' && presenting) stopPresenting();
    else return;
    e.preventDefault();
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (mode !== 'full' && !presenting) return;
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, presenting]);
  const presentingRef = useRef(false);
  presentingRef.current = presenting;
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setPresenting(false);
      // Full screen granted after presenting already ended (an Escape in between): leave it.
      else if (document.fullscreenElement === box.current && !presentingRef.current)
        void document.exitFullscreen?.().catch(() => {});
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // A click on the slide moves on (the left third goes back), unless it's on a link.
  const onSlideClick = (e: React.MouseEvent) => {
    if ((e.target as Element).closest?.('a')) return;
    const r = e.currentTarget.getBoundingClientRect();
    go(e.clientX - r.left < r.width / 3 ? at - 1 : at + 1);
  };

  if (error) return <DiagramError kind="marp" message={error} />;
  return (
    <div
      ref={box}
      className="leaf-deck"
      data-mode={mode}
      data-presenting={presenting ? '' : undefined}
      tabIndex={mode === 'mini' ? 0 : undefined}
      onKeyDown={mode === 'mini' && !presenting ? onKey : undefined}
    >
      {/* Two elements, never one reused: the slides keep their own shadow root, hidden
          while the overview shows. */}
      {overview && <div key="overview" ref={grid} className="leaf-deck-overview" />}
      <div
        key="slides"
        ref={slides}
        className="leaf-deck-slides"
        hidden={overview}
        data-presenting={presenting ? '' : undefined}
        onClick={onSlideClick}
      />
      {mode === 'full' && !presenting && showNotes && !overview && (
        <section className="leaf-deck-notes" aria-label="Speaker notes">
          {deck?.notes[at] ? (
            <Markdown source={deck.notes[at]!} docPath={docPath} />
          ) : (
            <p className="leaf-deck-notes-empty">No notes for this slide.</p>
          )}
        </section>
      )}
      <div className="leaf-deck-bar" role="group" aria-label="Slides">
        <button
          type="button"
          className="leaf-tool"
          aria-label="Previous slide"
          title="Previous slide"
          disabled={at <= 0}
          onClick={() => go(at - 1)}
        >
          ‹
        </button>
        <span className="leaf-deck-count" role="status" aria-label="Slide">
          {count ? `${at + 1} / ${count}` : ''}
        </span>
        <button
          type="button"
          className="leaf-tool"
          aria-label="Next slide"
          title="Next slide"
          disabled={at >= count - 1}
          onClick={() => go(at + 1)}
        >
          ›
        </button>
        {mode === 'full' && !presenting && (
          <>
            <span className="leaf-tool-sep" />
            <button
              type="button"
              className="leaf-tool leaf-tool-text"
              aria-label="All slides"
              aria-pressed={overview}
              onClick={() => setOverview((v) => !v)}
            >
              All slides
            </button>
            <button
              type="button"
              className="leaf-tool leaf-tool-text"
              aria-label="Notes"
              title="Show or hide the speaker notes under the slide"
              aria-pressed={showNotes}
              onClick={() => setShowNotes((v) => !v)}
            >
              Notes
            </button>
            <button
              type="button"
              className="leaf-tool leaf-tool-text"
              aria-label="Present"
              onClick={present}
            >
              Present
            </button>
            <button
              type="button"
              className="leaf-tool leaf-tool-text"
              aria-label="Speaker view"
              title="Open the speaker view: notes, the next slide, and a timer, in a window of its own"
              onClick={() => void openSpeaker(docPath)}
            >
              Speaker
            </button>
          </>
        )}
        {presenting && (
          <button
            type="button"
            className="leaf-tool leaf-tool-text"
            aria-label="Stop presenting"
            onClick={stopPresenting}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
