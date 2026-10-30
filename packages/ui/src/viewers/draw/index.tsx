// Freeform drawing: ```draw blocks and .draw files. Only this stub loads with leaf;
// the board arrives the first time a drawing appears.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const DrawBoard = lazy(() => track(load(() => import('./DrawBoard.js'))));
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

export const draw: Viewer = {
  id: 'draw',
  matches: { ext: ['.draw'], lang: ['draw'] },
  Inline: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <DrawBoard {...p} />
    </Suspense>
  ),
  Rich: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <DrawBoard {...p} fill />
    </Suspense>
  ),
  stage: {},
};
