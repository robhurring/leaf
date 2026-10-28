// ⌘F: find in the open document. Enter / Shift-Enter (or ctrl-n / ctrl-p) step through.
import { useEffect, useRef, useState } from 'react';
import { Chevron, Search, X } from '../icons/index.js';
import { clearMatches, findMatches, paintMatches, revealRange } from '../find.js';

type Props = {
  /** The element holding the rendered document. */
  root(): Element | null;
  /** The element that scrolls it. */
  scroller(): HTMLElement | null;
  initial?: string;
  /** The match to start on. */
  initialIndex?: number;
  onClose(): void;
};

export function FindBar({ root, scroller, initial = '', initialIndex = 0, onClose }: Props) {
  const [q, setQ] = useState(initial);
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(initialIndex);
  const typed = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // Search now, and again whenever the document re-renders (live reload, highlighting).
  useEffect(() => {
    const el = root();
    if (!el) return;
    const run = () => {
      const found = findMatches(el, q.trim());
      setRanges(found);
      setIndex((i) => (i < found.length ? i : 0));
    };
    run();
    let t: ReturnType<typeof setTimeout> | undefined;
    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(run, 120);
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(t);
      mo.disconnect();
    };
  }, [q, root]);

  // A new query starts from the first match; the initial one keeps initialIndex.
  useEffect(() => {
    if (typed.current) setIndex(0);
    typed.current = true;
  }, [q]);

  useEffect(() => {
    paintMatches(ranges, index);
    const cur = ranges[index];
    if (cur) revealRange(cur, scroller());
  }, [ranges, index, scroller]);

  useEffect(() => clearMatches, []);

  const step = (d: 1 | -1) =>
    setIndex((i) => (ranges.length ? (i + d + ranges.length) % ranges.length : 0));

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey && !e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' || (e.metaKey && k === 'g')) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (ctrl && (k === 'n' || k === 'p')) {
      e.preventDefault();
      step(k === 'n' ? 1 : -1);
    }
  };

  const count = !q.trim() ? '' : ranges.length ? `${index + 1} of ${ranges.length}` : 'No results';

  return (
    <div className="leaf-find" role="search">
      <Search size={14} />
      <input
        ref={input}
        type="search"
        aria-label="Find in document"
        placeholder="Find in document"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
      />
      <span className="leaf-find-count" aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={!ranges.length}
        onClick={() => step(-1)}
      >
        <Chevron size={14} style={{ transform: 'rotate(-90deg)' }} />
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={!ranges.length}
        onClick={() => step(1)}
      >
        <Chevron size={14} style={{ transform: 'rotate(90deg)' }} />
      </button>
      <button type="button" aria-label="Close find" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
