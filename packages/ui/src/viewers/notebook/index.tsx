// Jupyter notebooks: .ipynb files and ```ipynb fences. Only this stub loads with
// leaf; the notebook view arrives the first time a notebook appears.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const NotebookView = lazy(() => track(load(() => import('./NotebookView.js'))));
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

export const notebook: Viewer = {
  id: 'notebook',
  matches: { ext: ['.ipynb'], lang: ['ipynb', 'notebook'] },
  Inline: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <NotebookView {...p} />
    </Suspense>
  ),
  Rich: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <NotebookView {...p} />
    </Suspense>
  ),
};
