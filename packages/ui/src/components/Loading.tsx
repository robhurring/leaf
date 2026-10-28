// A loader for a document that takes a moment: hidden for the first 250 ms so fast
// opens never flash, then a small spinner and the file's name.
import { useEffect, useState } from 'react';

export function Loading({ label, delayMs = 250 }: { label?: string; delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    <div className="leaf-doc-state leaf-loading" role="status" aria-busy="true">
      {shown && (
        <>
          <span className="leaf-spinner" aria-hidden="true" />
          <p className="leaf-loading-label">{label ? `Opening ${label}` : 'Opening'}</p>
        </>
      )}
    </div>
  );
}
