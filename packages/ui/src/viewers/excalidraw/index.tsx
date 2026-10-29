// Excalidraw scenes (.excalidraw files or ```excalidraw fences) exported to a
// static SVG. The excalidraw package is large and loads on first use.
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { contentHash } from '../hash.js';
import { useAppearance } from '../appearance.js';

type Scene = {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

function parseScene(text: string): Scene {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not valid Excalidraw JSON.');
  }
  const scene = data as Partial<Scene>;
  if (!scene || !Array.isArray(scene.elements))
    throw new Error('This is not a valid Excalidraw scene (no elements).');
  return { elements: scene.elements, appState: scene.appState ?? {}, files: scene.files ?? {} };
}

function ExcalidrawView({ content, appearance }: ViewerProps) {
  const text = content ?? '';
  const key = useMemo(() => contentHash(text), [text]);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ key: string; error?: string }>({ key: '' });
  const dark = useAppearance(appearance) === 'dark';

  useEffect(() => {
    let live = true;
    (async () => {
      const scene = parseScene(text);
      const { exportToSvg } = await track(load(() => import('@excalidraw/excalidraw')));
      const svg = await exportToSvg({
        elements: scene.elements as never,
        appState: { ...scene.appState, exportWithDarkMode: dark, exportBackground: false } as never,
        files: scene.files as never,
      });
      if (!live || !host.current) return;
      host.current.replaceChildren(svg);
      setState({ key });
    })().catch(
      (e: unknown) => live && setState({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [key, text, dark]);

  if (state.key === key && state.error)
    return <DiagramError kind="excalidraw" message={state.error} />;
  return <div ref={host} className="leaf-diagram leaf-excalidraw" aria-busy={state.key !== key} />;
}

export const excalidraw: Viewer = {
  id: 'excalidraw',
  matches: { ext: ['.excalidraw'], lang: ['excalidraw'] },
  Inline: ExcalidrawView,
  Rich: ExcalidrawView,
  stage: { pan: true, zoom: true, draw: true },
};
