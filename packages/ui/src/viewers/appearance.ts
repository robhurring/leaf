// Which rendering a viewer should produce. Order: an explicit prop (the Stage
// asks for light on its white canvas), then the live appearance the Reader
// provides through context, then the document's data-appearance attribute for
// embedders that set it themselves.
import { createContext, useContext, useEffect, useState } from 'react';

export type Resolved = 'light' | 'dark';

export const AppearanceContext = createContext<Resolved | null>(null);

function fromDocument(): Resolved {
  return typeof document !== 'undefined' && document.documentElement.dataset.appearance === 'dark'
    ? 'dark'
    : 'light';
}

/** Resolves 'auto' against the OS setting. */
export function resolveAppearance(appearance: 'light' | 'dark' | 'auto'): Resolved {
  if (appearance !== 'auto') return appearance;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** The resolved appearance, following OS changes while set to 'auto'. */
export function useResolvedAppearance(appearance: 'light' | 'dark' | 'auto'): Resolved {
  const [resolved, setResolved] = useState(() => resolveAppearance(appearance));
  useEffect(() => {
    setResolved(resolveAppearance(appearance));
    if (appearance !== 'auto' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [appearance]);
  return resolved;
}

/** For viewers: prop, then context, then the document. */
export function useAppearance(prop?: Resolved): Resolved {
  const ctx = useContext(AppearanceContext);
  return prop ?? ctx ?? fromDocument();
}

export function isDark(appearance?: Resolved): boolean {
  return (appearance ?? fromDocument()) === 'dark';
}
