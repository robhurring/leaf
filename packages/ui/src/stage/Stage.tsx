// The Stage: a viewer's Rich component on a pan/zoom layer, the toolbox, and (when
// the viewer allows) the drawing layer. StageCanvas is the working part; Stage is the
// zoom-in pop-up around it, and a whole diagram file shows a StageCanvas inline.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { X } from '../icons/index.js';
import { createPortal } from 'react-dom';
import { useStage, type StageContent, type StageTool } from '../store/stage.js';
import { useAnnotations } from '../store/annotations.js';
import { Draw, useDrawing } from './Draw.js';
import { Toolbox } from './Toolbox.js';
import { contentSize, sizeSvgs } from './measure.js';
import { gestureFactor, wheelIntent } from './wheel.js';
import { createViewport, type Transform } from './viewport.js';

type CanvasProps = {
  content: StageContent;
  /** In the pop-up: Escape closes, and the page behind must not scroll. */
  onClose?: () => void;
  /** Inline: where the toolbox goes (the file header's toolbar); absent, it floats. */
  toolsSlot?: HTMLElement | null;
  /** Inline: render the picture in the app's appearance rather than always light. */
  inline?: boolean;
};

const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

export function StageCanvas({ content, onClose, toolsSlot, inline = false }: CanvasProps) {
  const open = content;
  const tool = useStage((s) => s.tool);
  const close = onClose;
  const viewport = useMemo(() => createViewport(), [open.blockHash, open.docPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const [t, setT] = useState<Transform>(viewport.get());
  const viewRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const drawing = useDrawing(open.docPath, open.blockHash);

  useEffect(() => viewport.subscribe(setT), [viewport]);
  useEffect(() => setT(viewport.get()), [viewport]);

  // Keys: Escape closes, 1 and 2 pick a tool, and holding space borrows the hand
  // (release returns the previous tool). While open, keep the document from scrolling.
  useEffect(() => {
    const canDraw = open.viewer.stage?.draw === true;
    let held: StageTool | null = null;
    const pick = (tool: StageTool) => {
      held = null;
      useStage.getState().setTool(tool);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close) return close();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Inline, the keys are the reader's while typing or while the pop-up is up.
      if (!close && (typing(e.target) || useStage.getState().open)) return;
      if (e.key === '1') return pick('hand');
      if (e.key === '2' && canDraw) return pick('pencil');
      if (e.key === ' ') {
        e.preventDefault();
        if (e.repeat) return;
        const { tool, setTool } = useStage.getState();
        if (tool !== 'hand') {
          held = tool;
          setTool('hand');
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || held === null) return;
      useStage.getState().setTool(held);
      held = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const prev = document.body.style.overflow;
    if (close) document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (close) document.body.style.overflow = prev;
    };
  }, [open, close]);

  // Wheel: a pinch or a mouse wheel zooms around the cursor; two-finger scrolling
  // pans. The page never scrolls underneath.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const intent = wheelIntent(e as WheelEvent & { wheelDeltaY?: number });
      if (intent === 'pan') return viewport.panBy(-e.deltaX, -e.deltaY);
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (intent === 'pinch' ? 0.01 : 0.002));
      viewport.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, factor);
    };
    // WebKit (the app's webview, Safari) reports trackpad pinch as gesture events.
    type GestureEvent = Event & { scale: number; clientX: number; clientY: number };
    let lastScale = 1;
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (e.type === 'gesturestart') {
        lastScale = 1;
        return;
      }
      if (e.type === 'gestureend') return;
      const rect = el.getBoundingClientRect();
      viewport.zoomAt(
        { x: g.clientX - rect.left, y: g.clientY - rect.top },
        gestureFactor(g.scale, lastScale),
      );
      lastScale = g.scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
      el.addEventListener(t, onGesture, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
        el.removeEventListener(t, onGesture);
    };
  }, [open, viewport]);

  // Fit once the content has a size (diagrams render asynchronously).
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof ResizeObserver === 'undefined') return;
    let done = false;
    const ro = new ResizeObserver(() => {
      if (done) return;
      sizeSvgs(layer);
      if (contentSize(layer)) {
        done = true;
        fit();
        ro.disconnect();
      }
    });
    ro.observe(layer);
    // Observe the picture too: the layer's own box may not change when a viewer swaps pending for svg.
    const mo = new MutationObserver(() => {
      if (done) return;
      sizeSvgs(layer);
      if (contentSize(layer)) {
        done = true;
        fit();
        ro.disconnect();
        mo.disconnect();
      }
    });
    mo.observe(layer, { childList: true, subtree: true, attributes: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fit = useCallback(() => {
    const view = viewRef.current;
    const layer = layerRef.current;
    if (!view || !layer) return;
    const size = contentSize(layer);
    if (size) viewport.fit(size.w, size.h, view.clientWidth, view.clientHeight);
  }, [viewport]);

  // Pointer position → content coordinates (the drawing layer lives inside the transformed layer).
  const contentPoint = (e: ReactPointerEvent): [number, number] => {
    const rect = viewRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const p = viewport.toContent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    return [p.x, p.y];
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or image drag under a stroke or a pan
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool === 'pencil' && open.viewer.stage?.draw) return drawing.start(contentPoint(e));
    if (tool === 'hand') drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (tool === 'pencil') return drawing.move(contentPoint(e));
    if (!drag.current) return;
    viewport.panBy(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = () => {
    drag.current = null;
    drawing.end();
  };

  const { viewer, props } = open;
  const Rich = viewer.Rich;
  const canDraw = viewer.stage?.draw === true;
  const centerZoom = (factor: number) => {
    const view = viewRef.current;
    if (!view) return;
    viewport.zoomAt({ x: view.clientWidth / 2, y: view.clientHeight / 2 }, factor);
  };
  const toolbox = (
    <Toolbox
      canDraw={canDraw}
      onZoom={centerZoom}
      onFit={fit}
      onReset={() => viewport.reset()}
      onClear={() => useAnnotations.getState().clear(open.docPath, open.blockHash)}
    />
  );

  return (
    <>
      <div
        ref={viewRef}
        data-testid="stage-viewport"
        className={`leaf-stage-viewport leaf-stage-tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => viewport.reset()}
      >
        <div
          ref={layerRef}
          data-testid="stage-layer"
          className="leaf-stage-layer"
          style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
        >
          <Rich {...props} appearance={inline ? props.appearance : 'light'} />
          {canDraw && (
            <Draw docPath={open.docPath} blockHash={open.blockHash} current={drawing.current} />
          )}
        </div>
      </div>
      {toolsSlot ? createPortal(toolbox, toolsSlot) : toolbox}
    </>
  );
}

/** The zoom-in pop-up. */
export function Stage() {
  const open = useStage((s) => s.open);
  const close = useStage((s) => s.close);
  const isStale = useAnnotations((s) => (open ? !s.isLive(open.docPath, open.blockHash) : false));
  if (!open) return null;
  return (
    <div className="leaf-stage-backdrop" onClick={close}>
      <div
        className="leaf-stage"
        role="dialog"
        aria-modal="true"
        aria-label="Zoomed view"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="leaf-stage-bar">
          <div className="leaf-stage-title" data-testid="stage-title">
            <span className="leaf-stage-kind">{open.lang ?? open.viewer.id}</span>
            <span className="leaf-stage-path">{open.docPath}</span>
          </div>
          <button
            type="button"
            className="leaf-stage-close"
            aria-label="Close"
            title="Close (esc)"
            onClick={close}
          >
            <X size={16} />
          </button>
        </div>
        <StageCanvas key={`${open.docPath}:${open.blockHash}`} content={open} onClose={close} />
        {isStale && (
          <div className="leaf-stage-banner" role="status">
            The diagram changed. Close and zoom in again to see the new version.
          </div>
        )}
      </div>
    </div>
  );
}
