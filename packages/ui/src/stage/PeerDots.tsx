// The other peers' pointers on a canvas in a share: a dot in each peer's colour with
// their name beside it, in content coordinates inside the transformed layer, so the
// dots sit on the same part of the picture for everyone.
import { useEffect } from 'react';
import { pointersOn, usePointers } from '../share/pointers.js';
import { useDocuments } from '../store/documents.js';

export function PeerDots({ docPath, blockHash }: { docPath: string; blockHash: string }) {
  const pointers = usePointers((s) => s.pointers);
  const presence = useDocuments((s) => s.presence);
  const here = pointersOn(pointers, docPath, blockHash);

  // Drop pointers that stopped moving, on a timer while any is on this canvas.
  const showing = here.length > 0;
  useEffect(() => {
    if (!showing) return;
    const t = setInterval(() => usePointers.getState().sweep(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showing]);

  if (!presence) return null;
  // Only peers still in the share, and never the page's own pointer.
  const peers = [presence.host, ...presence.viewers].filter((p) => p.id !== presence.you);
  const dots = here.flatMap(([id, at]) => {
    const peer = peers.find((p) => p.id === id);
    return peer ? [{ peer, at }] : [];
  });
  if (!dots.length) return null;
  return (
    <svg className="leaf-peer-dots">
      {dots.map(({ peer, at }) => (
        <g key={peer.id} role="img" aria-label={peer.name}>
          <circle className="leaf-peer-dot" cx={at.x} cy={at.y} r={6} fill={peer.color} />
          <text className="leaf-peer-tag" x={at.x + 10} y={at.y + 4} fill={peer.color}>
            {peer.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
