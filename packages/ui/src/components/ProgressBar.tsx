// A thin indeterminate bar along the top edge while something loads on demand.
// Hidden for the first 150 ms so quick loads never flash, and while the server is out of
// reach: the disconnected marks say why nothing is arriving.
import { useEffect, useState } from 'react';
import { useProgress } from '../render/progress.js';
import { useConnection } from '../render/connection.js';

export function ProgressBar({ delayMs = 150 }: { delayMs?: number }) {
  const pending = useProgress((s) => s.pending > 0);
  const offline = useConnection((s) => s.offline);
  const busy = pending && !offline;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) return setShown(false);
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [busy, delayMs]);
  if (!busy || !shown) return null;
  return <div className="leaf-progress" role="progressbar" aria-label="Loading" />;
}
