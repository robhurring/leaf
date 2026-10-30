// The hover toolbar around any inline block: copy source, and for visual viewers
// zoom and pan in place, the zoomed view (the Stage), copy as image and (for SVG
// output) download.
// It also registers the block as live so sticky ink can be told from stale ink.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { DocToolsContext } from './Properties.js';
import {
  Check,
  Code,
  Copy,
  Download,
  Hand,
  Image as ImageIcon,
  Minus,
  Plus,
  X,
  ZoomIn,
} from '../icons/index.js';
import { useAnnotations } from '../store/annotations.js';
import { useStage } from '../store/stage.js';
import { usePinch } from '../stage/usePinch.js';
import {
  copyCanvas,
  copyFrame,
  copyImage,
  copyRaster,
  downloadText,
  svgElementToString,
} from '../stage/image.js';
import { contentHash } from '../viewers/hash.js';
import { SourceView, sourceLang } from './SourceView.js';
import type { Viewer, ViewerProps } from '../viewers/types.js';

type Props = {
  viewer: Viewer;
  props: ViewerProps;
  lang?: string;
  children: ReactNode;
  className?: string;
  /** The block's source lines in its document, for overlays that anchor to them. */
  'data-pos'?: string;
};

/** The rendered picture inside the frame: the diagram's svg or img, never a toolbar icon. */
/** The block's tools (the hover toolbar, or the file toolbar for a whole file), for a
 *  viewer to add its own controls to. */
export const BlockToolsContext = createContext<HTMLElement | null>(null);

type Picture = SVGSVGElement | HTMLImageElement | HTMLCanvasElement | HTMLIFrameElement;
function pictureIn(host: HTMLElement | null): Picture | null {
  if (!host) return null;
  return host.querySelector<Picture>(
    '.leaf-diagram svg, .leaf-diagram img, img.leaf-image, .leaf-image svg, .leaf-chart canvas, .leaf-live iframe',
  );
}

type View = { x: number; y: number; scale: number };
const HOME: View = { x: 0, y: 0, scale: 1 };
const clampScale = (s: number) => Math.min(8, Math.max(0.25, s));

export function BlockFrame({
  viewer,
  props,
  lang,
  children,
  className = '',
  'data-pos': pos,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Which action just finished, and how: its button shows a check or an x for a moment.
  const [result, setResult] = useState<{ id: string; r: 'ok' | 'failed' } | null>(null);
  const [picture, setPicture] = useState<'svg' | 'img' | 'canvas' | 'iframe' | null>(null);
  const visual = viewer.stage !== undefined;
  // The tools element, for a viewer to add its own controls to (a notebook's Hide code).
  const [toolsEl, setToolsEl] = useState<HTMLElement | null>(null);
  // A picture made from text (a diagram, chart, map, or animation) can flip to that text.
  const [showSource, setShowSource] = useState(false);
  // A whole file (not a block in a document): fill the area, tools in the file header.
  const slot = useContext(DocToolsContext);
  const source = props.content ?? '';
  const blockHash = contentHash(source);
  // Zoom and pan in place, for a diagram in a document. The Stage does it for whole files.
  const [view, setView] = useState<View>(HOME);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const hasSource = visual && viewer.id !== 'image' && source.trim() !== '';
  const zoomable = visual && !!viewer.stage?.zoom && !slot && !showSource;
  const moved = view.x !== 0 || view.y !== 0 || view.scale !== 1;
  const zoom = (factor: number) => setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));
  // A pinch zooms around the fingers. The view scales about its center, so keep the
  // point under the fingers where it is.
  const viewEl = useRef<HTMLDivElement>(null);
  const pinch = useCallback((p: { x: number; y: number }, factor: number) => {
    const el = viewEl.current;
    if (!el) return;
    const cx = el.offsetWidth / 2;
    const cy = el.offsetHeight / 2;
    setView((v) => {
      const scale = clampScale(v.scale * factor);
      const k = scale / v.scale;
      return { scale, x: p.x - cx - (p.x - cx - v.x) * k, y: p.y - cy - (p.y - cy - v.y) * k };
    });
  }, []);
  usePinch(viewEl, pinch, zoomable);
  const onPointerDown = (e: PointerEvent) => {
    // Zoomed in, a drag pans; otherwise only with the hand chosen.
    if (!(panning || view.scale > 1) || e.button !== 0) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + e.clientX - from.x, y: v.y + e.clientY - from.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  useEffect(
    () => useAnnotations.getState().trackBlock(props.docPath, blockHash),
    [props.docPath, blockHash],
  );

  // Viewers render asynchronously; learn what kind of picture is in the frame once it exists.
  useEffect(() => {
    if (!visual || !host.current || typeof MutationObserver === 'undefined') return;
    const update = () => {
      const p = pictureIn(host.current);
      const tag = p?.tagName.toLowerCase();
      setPicture(tag === 'img' || tag === 'canvas' || tag === 'iframe' ? tag : tag ? 'svg' : null);
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(host.current, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [visual, blockHash]);

  // Each action reports by turning its own icon into a check or an x for a moment.
  const flash = (id: string, r: 'ok' | 'failed') => {
    setResult({ id, r });
    setTimeout(() => setResult((cur) => (cur?.id === id ? null : cur)), 1500);
  };
  const run = async (id: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      flash(id, 'ok');
    } catch {
      flash(id, 'failed');
    }
  };
  const resultOf = (id: string) => (result?.id === id ? result.r : undefined);
  const iconOr = (id: string, icon: ReactNode) =>
    result?.id === id ? result.r === 'ok' ? <Check size={15} /> : <X size={15} /> : icon;
  const name = `${
    props.docPath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'diagram'
  }-${lang ?? viewer.id}.svg`;

  const tools = (
    <div className="leaf-block-tools" role="group" aria-label="Block tools" ref={setToolsEl}>
      {zoomable && (
        <>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoom(1 / 1.25)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoom(1.25)}
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="leaf-tool leaf-tool-text"
            aria-label="Reset zoom"
            title="Reset zoom"
            disabled={!moved}
            onClick={() => setView(HOME)}
          >
            {Math.round(view.scale * 100)}%
          </button>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Pan"
            title="Pan"
            aria-pressed={panning}
            onClick={() => setPanning((p) => !p)}
          >
            <Hand size={15} />
          </button>
          <span className="leaf-tool-sep" />
        </>
      )}
      {hasSource && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Show source"
          title={showSource ? 'Back to the picture' : 'Show the source'}
          aria-pressed={showSource}
          onClick={() => setShowSource((v) => !v)}
        >
          <Code size={15} />
        </button>
      )}
      {visual && picture && !showSource && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Copy as image"
          title="Copy as image"
          data-result={resultOf('image')}
          onClick={() =>
            run('image', async () => {
              const p = pictureIn(host.current);
              if (!p) throw new Error('nothing to copy');
              if (p instanceof HTMLImageElement) await copyRaster(p);
              else if (p instanceof HTMLCanvasElement) await copyCanvas(p);
              else if (p instanceof HTMLIFrameElement) await copyFrame(p);
              else await copyImage(p);
            })
          }
        >
          {iconOr('image', <ImageIcon size={15} />)}
        </button>
      )}
      <button
        type="button"
        className="leaf-tool"
        aria-label="Copy source"
        title="Copy source"
        data-result={resultOf('source')}
        onClick={() => run('source', () => navigator.clipboard.writeText(source))}
      >
        {iconOr('source', <Copy size={15} />)}
      </button>
      {visual && picture === 'svg' && !showSource && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Download SVG"
          title="Download SVG"
          data-result={resultOf('download')}
          onClick={() =>
            run('download', () => {
              const p = pictureIn(host.current);
              if (!(p instanceof SVGSVGElement)) throw new Error('nothing to download');
              downloadText(svgElementToString(p), name);
            })
          }
        >
          {iconOr('download', <Download size={15} />)}
        </button>
      )}
      {visual && !showSource && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Open zoomed view"
          title="Open zoomed view"
          onClick={() =>
            useStage
              .getState()
              .openStage({ docPath: props.docPath, blockHash, viewer, props, lang })
          }
        >
          <ZoomIn size={15} />
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={host}
      className={`leaf-block leaf-frame ${className}`}
      data-pos={pos}
      data-lang={lang ?? viewer.id}
      data-viewer={viewer.id}
      data-full={slot ? '' : undefined}
      data-zoomed={zoomable && moved ? '' : undefined}
    >
      {lang && lang !== 'text' && (!visual || showSource) && !slot && (
        <span className="leaf-block-lang">{lang}</span>
      )}
      {slot ? createPortal(tools, slot) : tools}
      <BlockToolsContext.Provider value={toolsEl}>
        {showSource ? (
          <SourceView code={source} lang={sourceLang(viewer.id, lang)} />
        ) : zoomable ? (
          <div
            ref={viewEl}
            className="leaf-block-view"
            data-panning={panning ? '' : undefined}
            style={
              moved
                ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
                : undefined
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => moved && setView(HOME)}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </BlockToolsContext.Provider>
    </div>
  );
}
