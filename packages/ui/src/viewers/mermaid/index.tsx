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

const DARK = {
  darkMode: true,
  background: '#0d1117',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  // Nodes: a blue tint with a clear border; decisions and clusters a step apart.
  primaryColor: '#1c2b41',
  primaryBorderColor: '#4f7cbf',
  primaryTextColor: '#e6edf3',
  secondaryColor: '#2a2140',
  secondaryBorderColor: '#8a6fd1',
  secondaryTextColor: '#e6edf3',
  tertiaryColor: '#16241c',
  tertiaryBorderColor: '#3f9e6a',
  tertiaryTextColor: '#e6edf3',
  mainBkg: '#1c2b41',
  nodeBorder: '#4f7cbf',
  nodeTextColor: '#e6edf3',
  textColor: '#c9d1d9',
  lineColor: '#8b949e',
  clusterBkg: '#141c27',
  clusterBorder: '#30405a',
  titleColor: '#e6edf3',
  // Edge labels on the page's own color instead of gray chips.
  edgeLabelBackground: '#0d1117',
  // Sequence diagrams.
  actorBkg: '#1c2b41',
  actorBorder: '#4f7cbf',
  actorTextColor: '#e6edf3',
  actorLineColor: '#5b6675',
  signalColor: '#c9d1d9',
  signalTextColor: '#e6edf3',
  labelBoxBkgColor: '#1c2b41',
  labelBoxBorderColor: '#4f7cbf',
  labelTextColor: '#e6edf3',
  loopTextColor: '#c9d1d9',
  noteBkgColor: '#3a3220',
  noteBorderColor: '#a8873a',
  noteTextColor: '#f0e6c8',
  activationBkgColor: '#2a3a55',
  activationBorderColor: '#4f7cbf',
};
const cache = new Map<string, Promise<string>>();

async function renderMermaid(code: string, dark: boolean): Promise<string> {
  const key = `${dark ? 'd' : 'l'}:${contentHash(code)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const mermaid = (await track(load(() => import('mermaid')))).default;
      mermaid.initialize({
        startOnLoad: false,
        // Dark: Mermaid's own dark theme draws every node the same near-black gray; our
        // palette gives nodes a tint, readable edges, and text with real contrast.
        theme: dark ? 'base' : 'default',
        themeVariables: dark ? DARK : { edgeLabelBackground: '#ffffff' },
        securityLevel: 'strict',
        // Labels as SVG text rather than HTML in foreignObject: a canvas drawn from HTML
        // in an SVG is tainted, so Copy as image failed for flowcharts and their kin.
        htmlLabels: false,
        flowchart: { htmlLabels: false },
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
