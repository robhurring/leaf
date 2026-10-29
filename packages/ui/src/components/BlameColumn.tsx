// The blame annotation column's shared pieces: whether it is showing (and how wide)
// for the document on screen, one annotation's markup, and the handle that resizes it.
import { createContext, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import type { BlameHunk } from '@leaf/protocol';
import { blameTitle, shortAge, splitPr } from '../blame.js';
import { BLAME_MAX, BLAME_MIN, useUi } from '../store/ui.js';

/** Blame as the document on screen shows it: off, or on at a width. */
export type BlameShown = { width: number } | null;
export const BlameShownContext = createContext<BlameShown>(null);

const link = (href: string, className: string, text: string) => (
  <a className={className} href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
);

/** `abc1234 Rob 3d #42` over the commit message; the hash and PR link out. */
export function BlameAnnotation({ hunk, repoUrl }: { hunk: BlameHunk; repoUrl?: string }) {
  if (hunk.uncommitted)
    return (
      <span className="leaf-blame-text" title={blameTitle(hunk)}>
        <span className="leaf-blame-label">Not committed yet</span>
      </span>
    );
  const short = hunk.commit.slice(0, 7);
  const { message, pr } = splitPr(hunk.summary);
  return (
    <span className="leaf-blame-text" title={blameTitle(hunk)}>
      <span className="leaf-blame-label">
        {repoUrl ? (
          link(`${repoUrl}/commit/${hunk.commit}`, 'leaf-blame-sha', short)
        ) : (
          <span className="leaf-blame-sha">{short}</span>
        )}{' '}
        <span className="leaf-blame-author">{hunk.author}</span>{' '}
        <span className="leaf-blame-age">{shortAge(hunk.date)}</span>
        {pr && (
          <>
            {' '}
            {repoUrl ? (
              link(`${repoUrl}/pull/${pr}`, 'leaf-blame-pr', `#${pr}`)
            ) : (
              <span className="leaf-blame-pr">#{pr}</span>
            )}
          </>
        )}
      </span>
      <span className="leaf-blame-summary">{message}</span>
    </span>
  );
}

const STEP = 16;

/** The column's right edge: drag it, or use the arrow keys, to resize. */
export function BlameResizer({ width }: { width: number }) {
  const setWidth = useUi((s) => s.setBlameWidth);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, w: width };
    document.documentElement.dataset.resizing = '';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(drag.current.w + e.clientX - drag.current.x);
  };
  const end = () => {
    drag.current = null;
    delete document.documentElement.dataset.resizing;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth(width + (e.key === 'ArrowRight' ? STEP : -STEP));
    }
  };
  return (
    <div
      className="leaf-blame-resizer"
      role="separator"
      aria-label="Resize blame"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={BLAME_MIN}
      aria-valuemax={BLAME_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    />
  );
}
