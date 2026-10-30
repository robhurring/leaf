// A sheet to draw on. Strokes live in the session's ink store, keyed like any
// block's sticky ink, so a block and its zoomed view share one drawing. Undo takes
// back the last stroke; invisible ink fades away. Nothing is written to the file:
// copy the picture or download it as SVG.
import { useContext, useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { BlockToolsContext } from '../../components/BlockFrame.js';
import { DocToolsContext } from '../../components/Properties.js';
import { Check, Download, Eraser, Fade, Image as ImageIcon, Undo, X } from '../../icons/index.js';
import { copyImage, downloadText, svgElementToString } from '../../stage/image.js';
import { INK_GONE_MS, strokesFor, useAnnotations, type Stroke } from '../../store/annotations.js';
import { BRUSH_WIDTHS, INK_COLORS, useStage, type InkColor } from '../../store/stage.js';
import { useAppearance } from '../appearance.js';
import { contentHash } from '../hash.js';
import type { ViewerProps } from '../types.js';

type Point = [number, number];

/** `size: 800x450` sets the sheet; anything else in the block is a note to yourself. */
export function sheetSize(code: string): { w: number; h: number } {
  const m = /^\s*size:\s*(\d+)\s*[x×]\s*(\d+)/im.exec(code);
  const w = m ? Math.min(4000, Math.max(100, Number(m[1]))) : 800;
  const h = m ? Math.min(4000, Math.max(100, Number(m[2]))) : 450;
  return { w, h };
}

const COLORS: InkColor[] = ['red', 'green', 'blue'];
const round = (n: number) => Math.round(n * 10) / 10;
const pathOf = (points: Point[]) =>
  points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export default function DrawBoard(props: ViewerProps & { fill?: boolean }) {
  const { docPath } = props;
  const code = props.content ?? props.file.path;
  // The same key the block frame and the file view use for this block's ink.
  const blockHash = contentHash(code);
  const { w, h } = sheetSize(props.content ?? '');
  const dark = useAppearance(props.appearance) === 'dark';
  const strokes = strokesFor(
    useAnnotations((s) => s.strokes),
    docPath,
    blockHash,
  );
  const color = useStage((s) => s.color);
  const [invisible, setInvisible] = useState(false);
  const [current, setCurrent] = useState<Point[] | null>(null);
  const live = useRef<Point[] | null>(null);
  const sheet = useRef<SVGSVGElement>(null);
  const blockTools = useContext(BlockToolsContext);
  const docTools = useContext(DocToolsContext);

  const undo = () => useAnnotations.getState().undo(docPath, blockHash);
  const clear = () => useAnnotations.getState().clear(docPath, blockHash);

  // Faded ink is dropped on a timer while any is on the sheet.
  const fading = strokes.some((s) => !s.sticky);
  useEffect(() => {
    if (!fading) return;
    const t = setInterval(() => useAnnotations.getState().expire(Date.now()), 1000);
    return () => clearInterval(t);
  }, [fading]);

  // A whole file (or the zoomed view) takes Cmd-Z from the window; a block only when focused.
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    if (blockTools) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (typing(e.target)) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blockTools]);

  const toSheet = (e: PointerEvent): Point => {
    const svg = sheet.current!;
    const ctm = svg.getScreenCTM?.();
    const p = ctm && svg.createSVGPoint?.();
    if (ctm && p && typeof p.matrixTransform === 'function') {
      p.x = e.clientX;
      p.y = e.clientY;
      const q = p.matrixTransform(ctm.inverse());
      return [round(q.x), round(q.y)];
    }
    const r = svg.getBoundingClientRect();
    const k = r.width ? w / r.width : 1;
    return [round((e.clientX - r.left) * k), round((e.clientY - r.top) * k)];
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    (e.currentTarget.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
    live.current = [toSheet(e)];
    setCurrent(live.current);
  };
  const onMove = (e: PointerEvent) => {
    if (!live.current) return;
    live.current = [...live.current, toSheet(e)];
    setCurrent(live.current);
  };
  const onUp = () => {
    const points = live.current;
    live.current = null;
    setCurrent(null);
    if (!points || points.length < 2) return;
    const s = useStage.getState();
    const stroke: Stroke = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      docPath,
      blockHash,
      points,
      color: s.color,
      width: BRUSH_WIDTHS[s.brush],
      sticky: !invisible,
      createdAt: Date.now(),
    };
    useAnnotations.getState().add(stroke);
  };

  // Each action turns its own icon into a check or an x for a moment.
  const [result, setResult] = useState<{ id: string; ok: boolean } | null>(null);
  const run = async (id: string, fn: () => Promise<void> | void) => {
    let ok = true;
    try {
      await fn();
    } catch {
      ok = false;
    }
    setResult({ id, ok });
    setTimeout(() => setResult((r) => (r?.id === id ? null : r)), 1500);
  };
  const icon = (id: string, el: React.ReactNode) =>
    result?.id === id ? result.ok ? <Check size={15} /> : <X size={15} /> : el;
  const name = `${
    props.file.path
      .split('/')
      .pop()!
      .replace(/\.draw$|#draw$/, '') || 'drawing'
  }.svg`;

  const tool = (
    label: string,
    title: string,
    onClick: () => void,
    child: React.ReactNode,
    pressed?: boolean,
    resultId?: string,
  ) => (
    <button
      key={label}
      type="button"
      className="leaf-tool"
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      data-result={resultId && result?.id === resultId ? (result.ok ? 'ok' : 'failed') : undefined}
      onClick={onClick}
    >
      {child}
    </button>
  );
  const tools = (
    <>
      {COLORS.map((c) =>
        tool(
          c[0]!.toUpperCase() + c.slice(1),
          `${c[0]!.toUpperCase() + c.slice(1)} ink`,
          () => useStage.getState().setColor(c),
          <span className="leaf-swatch" style={{ background: INK_COLORS[c] }} />,
          color === c,
        ),
      )}
      {tool(
        'Invisible ink',
        'Invisible ink: strokes fade away',
        () => setInvisible((v) => !v),
        <Fade size={15} />,
        invisible,
      )}
      {tool('Undo', 'Undo (⌘Z)', undo, <Undo size={15} />)}
      {tool('Clear drawing', 'Clear drawing', clear, <Eraser size={15} />)}
      {/* In a document the block's own Copy as image and Download SVG cover these. */}
      {!blockTools && (
        <>
          {tool(
            'Copy as image',
            'Copy as image',
            () => void run('copy', () => copyImage(sheet.current!)),
            icon('copy', <ImageIcon size={15} />),
            undefined,
            'copy',
          )}
          {tool(
            'Download SVG',
            'Download SVG',
            () =>
              void run('download', () => downloadText(svgElementToString(sheet.current!), name)),
            icon('download', <Download size={15} />),
            undefined,
            'download',
          )}
        </>
      )}
    </>
  );
  const target = blockTools ?? docTools;

  return (
    <div
      className="leaf-diagram leaf-draw-board"
      data-fill={props.fill ? '' : undefined}
      tabIndex={blockTools ? 0 : undefined}
      onKeyDown={
        blockTools
          ? (e) => {
              if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo();
              }
            }
          : undefined
      }
    >
      {target ? createPortal(tools, target) : <div className="leaf-draw-bar">{tools}</div>}
      <svg
        ref={sheet}
        className="leaf-drawing"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Drawing"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <rect width={w} height={h} fill={dark ? '#1f2023' : '#ffffff'} />
        {strokes.map((s) => (
          <path
            key={s.id}
            className={`leaf-ink${s.sticky ? '' : ' leaf-ink-fade'}`}
            d={pathOf(s.points)}
            fill="none"
            stroke={INK_COLORS[s.color]}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={s.sticky ? undefined : { animationDuration: `${INK_GONE_MS}ms` }}
          />
        ))}
        {current && current.length > 1 && (
          <path
            className="leaf-ink leaf-ink-live"
            d={pathOf(current)}
            fill="none"
            stroke={INK_COLORS[color]}
            strokeWidth={BRUSH_WIDTHS[useStage.getState().brush]}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}
