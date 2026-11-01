// Live animation blocks: ```three and ```canvas fences run as sandboxed panes. Only
// this stub loads with leaf; the pane and its harness arrive with the first live block.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const LivePane = lazy(() =>
  track(load(() => import('./LivePane.js').then((m) => ({ default: m.LivePane })))),
);
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

function LiveInline(props: ViewerProps) {
  return (
    <Suspense fallback={<Pending />}>
      <LivePane {...props} />
    </Suspense>
  );
}

function LiveRich(props: ViewerProps) {
  return (
    <Suspense fallback={<Pending />}>
      <LivePane {...props} fill />
    </Suspense>
  );
}

export const live: Viewer = {
  id: 'live',
  matches: { lang: ['three', 'canvas'], ext: ['.three', '.sketch'] },
  Inline: LiveInline,
  Rich: LiveRich,
  stage: {},
};
