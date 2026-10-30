// The floating toolbox on the Stage: hand, pencil, zoom, ink options.
import { useState } from 'react';
import {
  Check,
  Download,
  Eraser,
  Hand,
  Image as ImageIcon,
  Minus,
  Pin,
  Plus,
  Undo,
  X,
  ZoomIn,
} from '../icons/index.js';
import { BRUSH_WIDTHS, INK_COLORS, useStage, type Brush, type InkColor } from '../store/stage.js';

type Props = {
  canDraw: boolean;
  onZoom(factor: number): void;
  onFit(): void;
  onReset(): void;
  onClear(): void;
  onUndo(): void;
  /** The picture with its ink, to the clipboard and as a file. */
  onCopy(): Promise<void>;
  onDownload(): Promise<void> | void;
};

const COLORS: InkColor[] = ['red', 'green', 'blue'];
const BRUSHES: Brush[] = ['small', 'medium', 'large'];
const label = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function Toolbox(props: Props) {
  const { canDraw, onZoom, onFit, onReset, onClear, onUndo, onCopy, onDownload } = props;
  const { tool, color, brush, sticky, setTool, setColor, setBrush, setSticky } = useStage();
  // Copy and download report by turning their own icon into a check or an x for a moment.
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
  const iconOr = (id: string, icon: React.ReactNode) =>
    result?.id === id ? result.ok ? <Check size={15} /> : <X size={15} /> : icon;
  const btn = (
    name: string,
    pressed: boolean | undefined,
    onClick: () => void,
    child: React.ReactNode,
    extra = '',
  ) => (
    <button
      key={name}
      type="button"
      className={`leaf-tb ${extra}`}
      aria-label={name}
      title={name}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {child}
    </button>
  );
  return (
    <div className="leaf-toolbox" role="toolbar" aria-label="Stage tools">
      {btn('Hand', tool === 'hand', () => setTool('hand'), <Hand size={16} />)}
      {canDraw && btn('Pencil', tool === 'pencil', () => setTool('pencil'), <PencilIcon />)}
      <span className="leaf-tb-sep" />
      {btn('Zoom out', undefined, () => onZoom(1 / 1.25), <Minus size={14} />)}
      {btn('Zoom in', undefined, () => onZoom(1.25), <Plus size={14} />)}
      {btn('Fit', undefined, onFit, <ZoomIn size={14} />)}
      {btn('Actual size', undefined, onReset, <span className="leaf-tb-text">1:1</span>)}
      {canDraw && (
        <>
          <span className="leaf-tb-sep" />
          {COLORS.map((c) =>
            btn(
              label(c),
              color === c,
              () => setColor(c),
              <span className="leaf-swatch" style={{ background: INK_COLORS[c] }} />,
              'leaf-tb-color',
            ),
          )}
          <span className="leaf-tb-sep" />
          {BRUSHES.map((b) =>
            btn(
              `${label(b)} brush`,
              brush === b,
              () => setBrush(b),
              <span
                className="leaf-dot-brush"
                style={{ width: BRUSH_WIDTHS[b] + 4, height: BRUSH_WIDTHS[b] + 4 }}
              />,
            ),
          )}
          <span className="leaf-tb-sep" />
          {btn('Sticky ink', sticky, () => setSticky(!sticky), <Pin size={15} />)}
          {btn('Undo', undefined, onUndo, <Undo size={15} />)}
          {btn('Clear drawings', undefined, onClear, <Eraser size={15} />)}
        </>
      )}
      <span className="leaf-tb-sep" />
      {btn(
        'Copy as image',
        undefined,
        () => void run('copy', onCopy),
        iconOr('copy', <ImageIcon size={15} />),
      )}
      {btn(
        'Download SVG',
        undefined,
        () => void run('download', onDownload),
        iconOr('download', <Download size={15} />),
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 20 4-1L19 8l-3-3L5 16z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}
