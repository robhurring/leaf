// Keeps a panel mounted long enough to slide out, and says when it is sliding in. A panel
// open from the start is just open: nothing slides as the page loads. With reduced motion
// (or no matchMedia, as in tests) a panel is open or gone at once.
import { useEffect, useState } from 'react';

export type Presence = 'opening' | 'open' | 'closing' | null;

const reduced = () =>
  typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePresence(open: boolean, ms = 220): Presence {
  // The last `open` whose slide has finished; while it differs, the panel is on its way.
  const [settled, setSettled] = useState(open);
  useEffect(() => {
    if (settled === open) return;
    if (reduced()) return setSettled(open);
    const t = setTimeout(() => setSettled(open), ms);
    return () => clearTimeout(t);
  }, [open, settled, ms]);
  if (settled === open || reduced()) return open ? 'open' : null;
  return open ? 'opening' : 'closing';
}
