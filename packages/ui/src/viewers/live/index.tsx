// Live animation blocks: ```three and ```canvas fences run as sandboxed panes.
import type { Viewer, ViewerProps } from '../types.js';
import { LivePane } from './LivePane.js';

function LiveInline(props: ViewerProps) {
  return <LivePane {...props} />;
}

function LiveRich(props: ViewerProps) {
  return <LivePane {...props} fill />;
}

export const live: Viewer = {
  id: 'live',
  matches: { lang: ['three', 'canvas'] },
  Inline: LiveInline,
  Rich: LiveRich,
  stage: {},
};
