// Mermaid, rendered in the browser. Memoized on content so live edits elsewhere
// in the document never re-render a diagram; parse errors show in place.
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { useEffect, useMemo, useState } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { contentHash } from '../hash.js';
import { useAppearance } from '../appearance.js';

let counter = 0;
const cache = new Map<string, Promise<string>>();

async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const key = `${dark ? 'd' : 'l'}:${contentHash(code)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const mermaid = (await track(load(() => import('mermaid')))).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? 'dark' : 'default',
        // Edge labels on the page's own color instead of gray chips.
        themeVariables: { edgeLabelBackground: dark ? '#0d1117' : '#ffffff' },
        securityLevel: 'strict',
        suppressErrorRendering: true,
      });
      const { svg } = await mermaid.render(`leaf-mermaid-${++counter}`, code);
      return svg;
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

function MermaidView({ content, appearance }: ViewerProps) {
  const code = (content ?? '').trim();
  const dark = useAppearance(appearance) === 'dark';
  const key = useMemo(() => `${dark}:${contentHash(code)}`, [code, dark]);
  const [state, setState] = useState<{ key: string; svg?: string; error?: string }>({ key: '' });

  useEffect(() => {
    let live = true;
    renderMermaid(code, dark)
      .then((svg) => live && setState({ key, svg }))
      .catch(
        (e: unknown) =>
          live && setState({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, [key, code, dark]);

  if (state.key !== key)
    return <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;
  if (state.error) return <DiagramError kind="mermaid" message={state.error} />;
  return (
    <div
      className="leaf-diagram leaf-mermaid"
      dangerouslySetInnerHTML={{ __html: state.svg ?? '' }}
    />
  );
}

export const mermaid: Viewer = {
  id: 'mermaid',
  matches: { ext: ['.mmd', '.mermaid'], lang: ['mermaid'] },
  Inline: MermaidView,
  Rich: MermaidView,
  stage: { pan: true, zoom: true, draw: true },
};
