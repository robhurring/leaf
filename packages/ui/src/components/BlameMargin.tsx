// Blame beside a rendered markdown document: each top-level block gets a region of the
// annotation column, as tall as the block, tinted by how recently its newest line
// changed, with the commit, author, age, and message.
import { useLayoutEffect, useRef, useState } from 'react';
import type { BlameHunk } from '@leaf/protocol';
import { freshness, hunksIn } from '../blame.js';
import { BlameAnnotation } from './BlameColumn.js';

/** Blocks shorter than this have room for the label line only. */
const SHORT = 38;

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
  repoUrl,
}: {
  /** The element holding the rendered article; regions are placed against it. */
  host: HTMLElement | null;
  hunks: BlameHunk[];
  repoUrl?: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const self = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!host) return;
    const measure = () => {
      const article = host.querySelector('article');
      if (!article) return setBlocks([]);
      const base = host.getBoundingClientRect().top;
      const out: Block[] = [];
      for (const child of article.children) {
        // A block or its frame (a fenced code block's) carries its source lines.
        const el = child.matches('[data-pos]') ? child : child.querySelector('[data-pos]');
        const lines = el && linesOf(el);
        if (!lines) continue;
        const hunk = newest(hunksIn(hunks, lines[0], lines[1]));
        if (!hunk) continue;
        const r = child.getBoundingClientRect();
        out.push({ key: `${lines[0]}`, top: r.top - base, height: r.height, hunk });
      }
      setBlocks(out);
    };
    measure();
    // The document renders progressively, and blocks move as images and diagrams load
    // and as the window resizes.
    // Changes to the margin itself don't move the blocks; ignoring them avoids a loop.
    const mo = new MutationObserver((records) => {
      if (records.some((r) => !self.current?.contains(r.target))) measure();
    });
    mo.observe(host, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(host);
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
  }, [host, hunks]);

  const fresh = freshness(hunks);
  return (
    <div className="leaf-blame-margin" aria-label="Blame" ref={self}>
      {blocks.map((b) => (
        <div
          key={b.key}
          className={`leaf-blame-block ${b.hunk.uncommitted ? 'leaf-blame-uncommitted' : ''} ${b.height < SHORT ? 'leaf-blame-short' : ''}`}
          style={
            {
              top: b.top,
              height: b.height,
              '--leaf-blame-fresh': fresh.get(b.hunk.commit) ?? 1,
            } as React.CSSProperties
          }
        >
          <BlameAnnotation hunk={b.hunk} repoUrl={repoUrl} />
        </div>
      ))}
    </div>
  );
}
