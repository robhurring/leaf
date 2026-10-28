// Keeps a panel mounted long enough to animate out. With reduced motion (or no
// matchMedia, as in tests) it unmounts at once.
import { useEffect, useState } from 'react';

export type Presence = 'open' | 'closing' | null;

const reduced = () =>
  typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePresence(open: boolean, ms = 220): Presence {
  const [state, setState] = useState<Presence>(open ? 'open' : null);
  useEffect(() => {
    if (open) return setState('open');
    if (reduced()) return setState(null);
    setState((s) => (s ? 'closing' : null));
    const t = setTimeout(() => setState(null), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return open ? 'open' : state;
}
