// Maps: .geojson and .topojson files and fences, and ```map blocks. Only this stub
// loads with leaf; the map view, its libraries, and the world arrive the first time
// a map appears.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const MapView = lazy(() => track(load(() => import('./MapView.js'))));
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

export const map: Viewer = {
  id: 'map',
  matches: { ext: ['.geojson', '.topojson'], lang: ['geojson', 'topojson', 'map'] },
  Inline: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <MapView {...p} />
    </Suspense>
  ),
  Rich: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <MapView {...p} fill />
    </Suspense>
  ),
  // The map zooms itself; the zoomed view gives it the whole area.
  stage: {},
};
