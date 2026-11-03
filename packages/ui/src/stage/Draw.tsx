// Drawing on the Stage. `useDrawing` owns the in-progress stroke and commits it
// to the session store; `Draw` renders strokes in content coordinates inside the
// transformed layer, so they pan and zoom with the diagram. Invisible ink fades
// and is dropped by a timer; sticky strokes stay for the session. In a share, a
// stroke streams to the others as it is drawn, then goes whole when it is done.
import { useEffect, useRef, useState } from 'react';
import {
  INK_GONE_MS,
  draftsFor,
  strokesFor,
  useAnnotations,
  type Stroke,
} from '../store/annotations.js';
import { BRUSH_WIDTHS, INK_COLORS, useStage } from '../store/stage.js';
import { useDocuments } from '../store/documents.js';
import { liveRole } from '../share/live.js';

export type ContentPoint = [number, number];

const round = (n: number) => Math.round(n * 100) / 100;
/** At most one `inking` frame per this long while a stroke is drawn. */
export const INKING_EVERY_MS = 50;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const pathOf = (points: ContentPoint[]) =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');

/** `share`: the canvas is in a share (not a draw board), so strokes go to the relay. */
export function useDrawing(docPath: string, blockHash: string, share = false) {
  const [current, setCurrent] = useState<ContentPoint[] | null>(null);
  const live = useRef<ContentPoint[] | null>(null);
  const id = useRef('');
  // Points not yet streamed, the time of the last frame, and a timer for a pause mid-stroke.
  const pending = useRef<ContentPoint[]>([]);
  const lastFrame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const streaming = () => share && liveRole(useDocuments.getState().share) !== null;
  const stroke = (points: ContentPoint[]): Stroke => {
    const { color, brush, sticky } = useStage.getState();
    return {
      id: id.current,
      docPath,
      blockHash,
      points,
      color,
      width: BRUSH_WIDTHS[brush],
      sticky,
      createdAt: Date.now(),
    };
  };
  const flush = () => {
    timer.current = null;
    if (!pending.current.length) return;
    lastFrame.current = Date.now();
    useDocuments.getState().tell({ type: 'inking', stroke: stroke(pending.current) });
    pending.current = [];
  };
  const stopStreaming = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = [];
  };
  useEffect(() => stopStreaming, []);

  const start = (p: ContentPoint) => {
    live.current = [[round(p[0]), round(p[1])]];
    setCurrent(live.current);
    id.current = newId();
    pending.current = streaming() ? [...live.current] : [];
    lastFrame.current = 0;
  };
  const move = (p: ContentPoint) => {
    if (!live.current) return;
    const point: ContentPoint = [round(p[0]), round(p[1])];
    live.current = [...live.current, point];
    setCurrent(live.current);
    if (!streaming()) return;
    pending.current.push(point);
    if (timer.current) return;
    const wait = INKING_EVERY_MS - (Date.now() - lastFrame.current);
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  };
  const end = () => {
    const points = live.current;
    live.current = null;
    setCurrent(null);
    stopStreaming();
    if (!points || points.length < 2) return;
    const whole = stroke(points);
    useAnnotations.getState().add(whole);
    if (streaming()) useDocuments.getState().tell({ type: 'ink', stroke: whole });
  };

  return { current, start, move, end, drawing: live.current !== null };
}

type Props = { docPath: string; blockHash: string; current: ContentPoint[] | null };

export function Draw({ docPath, blockHash, current }: Props) {
  const strokes = useAnnotations((s) => s.strokes);
  const drafts = useAnnotations((s) => s.drafts);
  const mine = strokesFor(strokes, docPath, blockHash);
  const theirs = draftsFor(drafts, docPath, blockHash);
  const { color, brush } = useStage();

  // Drop faded ink, and abandoned strokes in progress, on a timer while any is present.
  const hasInk = mine.some((s) => !s.sticky) || theirs.length > 0;
  useEffect(() => {
    if (!hasInk) return;
    const t = setInterval(() => useAnnotations.getState().expire(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasInk]);

  return (
    <svg className="leaf-draw" aria-hidden="true">
      {mine.map((s) => (
        <path
          key={s.id}
          className={`leaf-ink ${s.sticky ? (s.stale ? 'leaf-ink-stale' : '') : 'leaf-ink-fade'}`}
          d={pathOf(s.points)}
          stroke={INK_COLORS[s.color]}
          strokeWidth={s.width}
          style={s.sticky ? undefined : { animationDuration: `${INK_GONE_MS}ms` }}
        />
      ))}
      {theirs.map((d) => (
        <path
          key={`${d.peer}/${d.id}`}
          className="leaf-ink leaf-ink-live"
          d={pathOf(d.points)}
          stroke={INK_COLORS[d.color]}
          strokeWidth={d.width}
        />
      ))}
      {current && current.length > 1 && (
        <path
          className="leaf-ink leaf-ink-live"
          d={pathOf(current)}
          stroke={INK_COLORS[color]}
          strokeWidth={BRUSH_WIDTHS[brush]}
        />
      )}
    </svg>
  );
}
