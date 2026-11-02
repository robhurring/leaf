// What part this page plays in a live share: the host's own tab, a viewer of someone's
// share, or neither.
import type { ShareInfo } from '@leaf/protocol';
import { inTab } from '../source/TauriSource.js';

export function liveRole(share: ShareInfo | null): 'host' | 'viewer' | null {
  return inTab() ? 'host' : share ? 'viewer' : null;
}
