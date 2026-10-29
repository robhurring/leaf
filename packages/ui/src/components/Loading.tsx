// A loader for a document that takes a moment: hidden for the first 250 ms so fast
// opens never flash, then a small spinner and the file's name. With the server out of
// reach it says so instead; the read is queued and goes out when the socket is back.
import { useEffect, useState } from 'react';
import { Unplugged } from '../icons/index.js';
import { useConnection } from '../render/connection.js';

export function Loading({ label, delayMs = 250 }: { label?: string; delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0);
  const offline = useConnection((s) => s.offline);
  useEffect(() => {
    if (delayMs <= 0) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    <div className="leaf-doc-state leaf-loading" role="status" aria-busy="true">
      {offline ? (
        <>
          <Unplugged
            size={22}
            className="leaf-offline-mark"
            role="img"
            aria-label="Disconnected"
            aria-hidden={false}
          />
          <p className="leaf-loading-label">
            Waiting for leaf to come back{label ? ` to open ${label}` : ''}
          </p>
        </>
      ) : (
        shown && (
          <>
            <span className="leaf-spinner" aria-hidden="true" />
            <p className="leaf-loading-label">{label ? `Opening ${label}` : 'Opening'}</p>
          </>
        )
      )}
    </div>
  );
}
