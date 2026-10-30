// Marp decks: .marp files, markdown with `marp: true`, and ```marp fences. Only this
// stub loads with leaf; the deck view and Marp arrive the first time a deck appears.
import { lazy, Suspense } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';

const DeckView = lazy(() => track(load(() => import('./DeckView.js'))));
const Pending = () => <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;

export const deck: Viewer = {
  id: 'deck',
  matches: { ext: ['.marp'], lang: ['marp'] },
  Inline: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <DeckView {...p} mode="mini" />
    </Suspense>
  ),
  Rich: (p: ViewerProps) => (
    <Suspense fallback={<Pending />}>
      <DeckView {...p} mode="full" />
    </Suspense>
  ),
  stage: {},
};
