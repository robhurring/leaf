// Drawing on the Stage. `useDrawing` owns the in-progress stroke and commits it
// to the session store; `Draw` renders strokes in content coordinates inside the
// transformed layer, so they pan and zoom with the diagram. Invisible ink fades
// and is dropped by a timer; sticky strokes stay for the session.
import { useCallback, useEffect, useRef, useState } from 'react';
import { INK_GONE_MS, strokesFor, useAnnotations, type Stroke } from '../store/annotations.js';
import { BRUSH_WIDTHS, INK_COLORS, useStage } from '../store/stage.js';

export type ContentPoint = [number, number];

const round = (n: number) => Math.round(n * 100) / 100;
const pathOf = (points: ContentPoint[]) =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');

export function useDrawing(docPath: string, blockHash: string) {
  const [current, setCurrent] = useState<ContentPoint[] | null>(null);
  const live = useRef<ContentPoint[] | null>(null);

  const start = useCallback((p: ContentPoint) => {
    live.current = [[round(p[0]), round(p[1])]];
    setCurrent(live.current);
  }, []);
  const move = useCallback((p: ContentPoint) => {
    if (!live.current) return;
    live.current = [...live.current, [round(p[0]), round(p[1])]];
    setCurrent(live.current);
  }, []);
  const end = useCallback(() => {
    const points = live.current;
    live.current = null;
    setCurrent(null);
    if (!points || points.length < 2) return;
    const { color, brush, sticky } = useStage.getState();
    const stroke: Stroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      docPath,
      blockHash,
      points,
      color,
      width: BRUSH_WIDTHS[brush],
      sticky,
      createdAt: Date.now(),
    };
    useAnnotations.getState().add(stroke);
  }, [docPath, blockHash]);

  return { current, start, move, end, drawing: live.current !== null };
}

type Props = { docPath: string; blockHash: string; current: ContentPoint[] | null };

export function Draw({ docPath, blockHash, current }: Props) {
  const strokes = useAnnotations((s) => s.strokes);
  const mine = strokesFor(strokes, docPath, blockHash);
  const { color, brush } = useStage();

  // Drop faded ink on a timer while any is present.
  const hasInk = mine.some((s) => !s.sticky);
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
