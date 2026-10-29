// PlantUML renders through a server (PLANTUML_URL); without one the source shows with a hint.
import { useEffect, useState } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { useAppearance } from '../appearance.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { preparePlantUml } from './prepare.js';

function PlantUmlView({ content, config, appearance }: ViewerProps) {
  const source = content ?? '';
  const dark = useAppearance(appearance) === 'dark';
  const base = config.plantumlUrl?.replace(/\/+$/, '');
  // The encoder (deflate) loads the first time a PlantUML diagram appears.
  const [encoded, setEncoded] = useState<string | null>(null);
  useEffect(() => {
    if (!base) return;
    let live = true;
    void track(load(() => import('./encode.js'))).then(({ encodePlantUml }) => {
      if (live) setEncoded(encodePlantUml(preparePlantUml(source, dark)));
    });
    return () => {
      live = false;
    };
  }, [base, source, dark]);
  if (!base) {
    return (
      <div className="leaf-plantuml-source">
        <p className="leaf-block-hint">Set PLANTUML_URL to render this diagram.</p>
        <pre>
          <code>{source}</code>
        </pre>
      </div>
    );
  }
  if (encoded === null)
    return <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;
  return (
    <div className="leaf-diagram leaf-plantuml-view">
      <img className="leaf-plantuml" src={`${base}/svg/${encoded}`} alt="PlantUML diagram" />
    </div>
  );
}

export const plantuml: Viewer = {
  id: 'plantuml',
  matches: { ext: ['.puml', '.plantuml', '.iuml'], lang: ['plantuml', 'puml'] },
  Inline: PlantUmlView,
  Rich: PlantUmlView,
  stage: { pan: true, zoom: true, draw: true },
};
