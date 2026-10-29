// Blame beside a rendered markdown document: each top-level block gets a bar in the
// left margin, shaded by how recently its newest line changed. A click on a bar shows
// that block's commit, author, and date; with details on, every block shows them.
import { useLayoutEffect, useState } from 'react';
import type { BlameHunk } from '@leaf/protocol';
import { blameLabel, blameTitle, freshness, hunksIn } from '../blame.js';

type Block = { key: string; top: number; height: number; hunk: BlameHunk };

/** `L:C-L:C` → the block's first and last source lines. */
function linesOf(el: Element): [number, number] | null {
  const m = /^(\d+):\d+-(\d+):\d+$/.exec(el.getAttribute('data-pos') ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The newest change among the lines (uncommitted counts as newest). */
function newest(hunks: BlameHunk[]): BlameHunk | undefined {
  return hunks.reduce<BlameHunk | undefined>(
    (best, h) => (!best || h.uncommitted || (!best.uncommitted && h.date > best.date) ? h : best),
    undefined,
  );
}

export function BlameMargin({
  host,
  hunks,
  details,
}: {
  /** The element holding the rendered article; bars are placed against it. */
  host: HTMLElement | null;
  hunks: BlameHunk[];
  details: boolean;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    const article = host?.querySelector('article');
    if (!host || !article) return;
    const measure = () => {
      const base = host.getBoundingClientRect().top;
      const out: Block[] = [];
      for (const el of article.querySelectorAll(':scope > [data-pos]')) {
        const lines = linesOf(el);
        if (!lines) continue;
        const hunk = newest(hunksIn(hunks, lines[0], lines[1]));
        if (!hunk) continue;
        const r = el.getBoundingClientRect();
        out.push({ key: `${lines[0]}`, top: r.top - base, height: r.height, hunk });
      }
      setBlocks(out);
    };
    measure();
    // Blocks move as images and diagrams load and as the window resizes.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(article);
    return () => ro.disconnect();
  }, [host, hunks]);

  const fresh = freshness(hunks);
  return (
    <div className={`leaf-blame-margin ${details ? 'leaf-blame-details' : ''}`} aria-label="Blame">
      {blocks.map((b) => {
        const shown = details || open.has(b.key);
        return (
          <div
            key={b.key}
            className={`leaf-blame-block ${b.hunk.uncommitted ? 'leaf-blame-uncommitted' : ''}`}
            style={
              {
                top: b.top,
                height: b.height,
                '--leaf-blame-fresh': fresh.get(b.hunk.commit) ?? 1,
              } as React.CSSProperties
            }
          >
            <button
              type="button"
              className="leaf-blame-bar"
              title={blameTitle(b.hunk)}
              aria-label={blameLabel(b.hunk)}
              aria-expanded={shown}
              onClick={() =>
                setOpen((o) => {
                  const next = new Set(o);
                  if (!next.delete(b.key)) next.add(b.key);
                  return next;
                })
              }
            />
            {shown && <span className="leaf-blame-label">{blameLabel(b.hunk)}</span>}
          </div>
        );
      })}
    </div>
  );
}
