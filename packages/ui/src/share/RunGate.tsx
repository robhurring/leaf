// In someone else's share, document code (live panes, notebook HTML) runs only when the
// viewer asks: Run for one block, or Allow for this session for every block of the share.
// Either choice lasts for this page load, not saved. A Run is for the block's content as
// it was: the key carries its hash, so code the host saves over it asks again.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useDocuments } from '../store/documents.js';
import { allowShare, hasRun, markRun, onAllowed, shareAllowed } from './ran.js';

export type RunGateProps = {
  /** What would run, for the placeholder's accessible name. */
  label: string;
  children: ReactNode;
  /** Identifies what would run: where it is, and the whole of its code (never a short
   *  hash of it, which can be made to collide). */
  gateKey: string;
  /** The height the pane would have, so the page doesn't jump when it runs. */
  height?: number;
  /** Called once the code is allowed to run (now, or earlier in this page load). */
  onRun?: () => void;
};

export default function RunGate({ label, children, gateKey, height, onRun }: RunGateProps) {
  const share = useDocuments((s) => s.share);
  // Asked of the current key on every render, never remembered here: the same gate stays
  // mounted while the block under it changes.
  const open = useSyncExternalStore(
    onAllowed,
    () => !share || hasRun(gateKey) || shareAllowed(share.id),
  );
  useEffect(() => {
    if (open) onRun?.();
  }, [open, onRun]);
  if (open || !share) return <>{children}</>;
  return (
    <div
      className="leaf-run-gate"
      role="group"
      aria-label={label}
      style={height ? { height } : undefined}
    >
      <span>Code from {share.host.name || 'the host'}’s share runs only when you ask</span>
      <div className="leaf-run-gate-actions">
        <button type="button" className="leaf-button" onClick={() => markRun(gateKey)}>
          Run
        </button>
        <button
          type="button"
          className="leaf-button leaf-button-quiet"
          onClick={() => allowShare(share.id)}
        >
          Allow for this session
        </button>
      </div>
    </div>
  );
}
