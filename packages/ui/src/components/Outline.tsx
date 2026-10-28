// The outline sidebar: nested headings, numbering, current heading tracking.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CollapseAll, ExpandAll } from '../icons/index.js';
import type { Heading } from '../render/headings.js';
import { formatNumber } from '../render/number.js';
import { IconButton } from './IconButton.js';
import type { Presence } from '../usePresence.js';

type Node = { heading: Heading; children: Node[] };

function nest(headings: Heading[]): Node[] {
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const h of headings) {
    const node: Node = { heading: h, children: [] };
    while (stack.length && stack[stack.length - 1]!.heading.depth >= h.depth) stack.pop();
    (stack.length ? stack[stack.length - 1]!.children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

type Props = {
  headings: Heading[];
  numbering: boolean;
  onJump(slug: string): void;
  /** Open, or animating closed. */
  state?: Presence;
};

export function Outline({ headings, numbering, onJump, state = 'open' }: Props) {
  const [current, setCurrent] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = useMemo(() => nest(headings), [headings]);

  // The heading being read: the last one at or above the reading line near the top.
  // Elements are looked up by id on every pass, since re-renders replace them.
  const pinned = useRef<string | null>(null);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.leaf-main');
    if (!scroller) return;
    const compute = () => {
      const box = scroller.getBoundingClientRect();
      // A clicked heading stays current while it is on screen: near the end of the page
      // it can never reach the top, but it is still the one being read.
      const pin = pinned.current && document.getElementById(pinned.current);
      if (pin) {
        const r = pin.getBoundingClientRect();
        if (r.bottom > box.top && r.top < box.bottom) return setCurrent(pinned.current);
        pinned.current = null;
      }
      const line = box.top + 80;
      let cur: string | null = headings[0]?.slug ?? null;
      for (const h of headings) {
        const el = document.getElementById(h.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) cur = h.slug;
        else break;
      }
      setCurrent(cur);
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };
    compute();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [headings]);

  const render = (list: Node[]) => (
    <ol>
      {list.map(({ heading: h, children }) => (
        <li
          key={h.slug}
          className={
            [h.depth === 1 && 'leaf-outline-title', h.slug === current && 'leaf-outline-current']
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          <a
            href={`#${h.slug}`}
            aria-current={h.slug === current ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              pinned.current = h.slug;
              setCurrent(h.slug);
              onJump(h.slug);
            }}
          >
            {numbering && h.number && (
              <span className="leaf-number">{formatNumber(h.number)} </span>
            )}
            {h.text}
          </a>
          {children.length > 0 && !collapsed.has(h.slug) && render(children)}
        </li>
      ))}
    </ol>
  );

  return (
    <nav
      className="leaf-outline"
      aria-label="Outline"
      data-state={state ?? undefined}
      aria-hidden={state === 'closing' || undefined}
    >
      <div className="leaf-side-head">
        <h2>Outline</h2>
        <IconButton label="Expand all" small onClick={() => setCollapsed(new Set())}>
          <ExpandAll size={14} />
        </IconButton>
        <IconButton
          label="Collapse all"
          small
          onClick={() =>
            // The title stays open, so its sections are what fold.
            setCollapsed(new Set(headings.filter((h) => h.depth > 1).map((h) => h.slug)))
          }
        >
          <CollapseAll size={14} />
        </IconButton>
      </div>
      {headings.length === 0 ? <p className="leaf-empty">No headings</p> : render(nodes)}
    </nav>
  );
}
