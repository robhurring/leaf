// The speaker's window for a deck: the slide on screen, the one after it, the slide's
// notes, how long the talk has run, and the time. It moves the presenting window along
// with it, and follows it.
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DiagramError } from '../diagramError.js';
import { AssetContext, rawUrl } from '../../render/components/assetContext.js';
import { renderDeck, type Deck } from './marp.js';
import { mountDeck, showSlide } from './slides.js';
import { deckChannel } from './sync.js';

const pad = (n: number) => String(n).padStart(2, '0');
const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

export function SpeakerView({ content, docPath }: { content: string; docPath: string }) {
  const resolve = useContext(AssetContext) ?? rawUrl;
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const current = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    renderDeck(content).then(
      (d) => live && (setDeck(d), setError(null)),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [content]);

  const count = deck?.count ?? 0;
  const at = Math.min(index, Math.max(0, count - 1));
  const go = (i: number) => setIndex(Math.max(0, Math.min(count - 1, i)));

  useLayoutEffect(() => {
    if (!deck) return;
    const stops = [current.current, next.current].flatMap((h) =>
      h ? [mountDeck(h, deck, docPath, resolve).stop] : [],
    );
    return () => stops.forEach((s) => s());
  }, [deck, docPath, resolve]);
  useLayoutEffect(() => {
    showSlide(current.current, at);
    showSlide(next.current, at + 1);
  }, [deck, at]);

  const channel = useRef<ReturnType<typeof deckChannel> | null>(null);
  useEffect(() => {
    const c = deckChannel(docPath, setIndex);
    channel.current = c;
    return () => c.close();
  }, [docPath]);
  useEffect(() => channel.current?.post(at), [at]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const goRef = useRef(go);
  goRef.current = go;
  const atRef = useRef(at);
  atRef.current = at;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key))
        goRef.current(atRef.current + 1);
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) goRef.current(atRef.current - 1);
      else if (e.key === 'Home') goRef.current(0);
      else if (e.key === 'End') goRef.current(Number.MAX_SAFE_INTEGER);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) return <DiagramError kind="marp" message={error} />;
  const notes = deck?.notes[at] ?? '';
  return (
    <div className="leaf-speaker">
      <div className="leaf-speaker-current" ref={current} />
      <aside className="leaf-speaker-side">
        <section className="leaf-speaker-next" aria-label="Next slide">
          <p className="leaf-speaker-label">{at + 1 < count ? 'Next' : 'The end'}</p>
          <div ref={next} className="leaf-speaker-next-slide" />
        </section>
        <div className="leaf-speaker-times">
          <span role="timer" aria-label="Time presenting">
            {elapsed(now - started)}
          </span>
          <button
            type="button"
            className="leaf-tool leaf-tool-text"
            onClick={() => {
              setStarted(Date.now());
              setNow(Date.now());
            }}
          >
            Restart timer
          </button>
          <span className="leaf-speaker-clock" aria-label="Time now">
            {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      </aside>
      <div className="leaf-speaker-notes" role="note" aria-label="Notes">
        {notes || <span className="leaf-speaker-empty">No notes for this slide.</span>}
      </div>
      <div className="leaf-deck-bar leaf-speaker-bar" role="group" aria-label="Slides">
        <button
          type="button"
          className="leaf-tool"
          aria-label="Previous slide"
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
          disabled={at >= count - 1}
          onClick={() => go(at + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default SpeakerView;
