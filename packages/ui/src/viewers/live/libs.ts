// three.js for live panes, fetched the first time a three block renders.
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import type { Libs } from './frame.js';

let three: Promise<Libs> | null = null;

export function loadThreeLibs(): Promise<Libs> {
  if (!three) {
    three = track(load(() => import('virtual:leaf-three'))).then((m) => ({ three: m.default }));
    three.catch(() => (three = null));
  }
  return three;
}
