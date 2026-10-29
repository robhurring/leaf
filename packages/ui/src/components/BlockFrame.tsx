// The hover toolbar around any inline block: copy source, and for visual viewers
// zoom and pan in place, the zoomed view (the Stage), copy as image and (for SVG
// output) download.
// It also registers the block as live so sticky ink can be told from stale ink.
import { useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DocToolsContext } from './Properties.js';
import {
  Check,
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
import { copyImage, copyRaster, downloadText, svgElementToString } from '../stage/image.js';
import { contentHash } from '../viewers/hash.js';
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
function pictureIn(host: HTMLElement | null): SVGSVGElement | HTMLImageElement | null {
  if (!host) return null;
  return host.querySelector<SVGSVGElement | HTMLImageElement>(
    '.leaf-diagram svg, .leaf-diagram img, img.leaf-image, .leaf-image svg',
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
  const [result, setResult] = useState<'ok' | 'failed' | null>(null);
  const [picture, setPicture] = useState<'svg' | 'img' | null>(null);
  const visual = viewer.stage !== undefined;
  // A whole file (not a block in a document): fill the area, tools in the file header.
  const slot = useContext(DocToolsContext);
  const source = props.content ?? '';
  const blockHash = contentHash(source);
  // Zoom and pan in place, for a diagram in a document. The Stage does it for whole files.
  const [view, setView] = useState<View>(HOME);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const zoomable = visual && !slot;
  const moved = view.x !== 0 || view.y !== 0 || view.scale !== 1;
  const zoom = (factor: number) => setView((v) => ({ ...v, scale: clampScale(v.scale * factor) }));
  const onPointerDown = (e: PointerEvent) => {
    if (!panning || e.button !== 0) return;
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
      setPicture(p ? (p.tagName.toLowerCase() === 'img' ? 'img' : 'svg') : null);
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(host.current, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [visual, blockHash]);

  // Each action reports with a brief check or x in the toolbar, never with text.
  const flash = (r: 'ok' | 'failed') => {
    setResult(r);
    setTimeout(() => setResult(null), 1500);
  };
  const run = async (fn: () => Promise<void> | void) => {
    try {
      await fn();
      flash('ok');
    } catch {
      flash('failed');
    }
  };
  const name = `${
    props.docPath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') ?? 'diagram'
  }-${lang ?? viewer.id}.svg`;

  const tools = (
    <div className="leaf-block-tools" role="group" aria-label="Block tools">
      {result && (
        <span className="leaf-tool-note" role="status" data-result={result}>
          {result === 'ok' ? <Check size={15} /> : <X size={15} />}
        </span>
      )}
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
      {visual && picture && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Copy as image"
          title="Copy as image"
          onClick={() =>
            run(async () => {
              const p = pictureIn(host.current);
              if (!p) throw new Error('nothing to copy');
              if (p instanceof HTMLImageElement) await copyRaster(p);
              else await copyImage(p);
            })
          }
        >
          <ImageIcon size={15} />
        </button>
      )}
      <button
        type="button"
        className="leaf-tool"
        aria-label="Copy source"
        title="Copy source"
        onClick={() => run(() => navigator.clipboard.writeText(source))}
      >
        <Copy size={15} />
      </button>
      {visual && picture === 'svg' && (
        <button
          type="button"
          className="leaf-tool"
          aria-label="Download SVG"
          title="Download SVG"
          onClick={() =>
            run(() => {
              const p = pictureIn(host.current);
              if (!p || p instanceof HTMLImageElement) throw new Error('nothing to download');
              downloadText(svgElementToString(p), name);
            })
          }
        >
          <Download size={15} />
        </button>
      )}
      {visual && (
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
      {lang && lang !== 'text' && !visual && !slot && (
        <span className="leaf-block-lang">{lang}</span>
      )}
      {slot ? createPortal(tools, slot) : tools}
      {zoomable ? (
        <div
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
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
