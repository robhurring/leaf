// Charts: ```chart blocks and .chart files. Only this stub loads with leaf; the chart
// view (and the YAML parser it uses) arrive the first time a chart appears, and
// Chart.js after that.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const ChartView = lazy(() => track(load(() => import('./ChartView.js'))));
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

export const chart: Viewer = {
  id: 'chart',
  matches: { ext: ['.chart'], lang: ['chart'] },
  Inline: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <ChartView {...p} />
    </Suspense>
  ),
  Rich: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <ChartView {...p} fill />
    </Suspense>
  ),
  stage: {},
};
