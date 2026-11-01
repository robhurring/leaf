// In someone else's share, document code (live panes, notebook HTML) runs only when the
// viewer asks. The choice lasts for this page load and is keyed by the block, not saved.
import { useEffect, useState, type ReactNode } from 'react';
import { useDocuments } from '../store/documents.js';
import { hasRun, markRun } from './ran.js';

export type RunGateProps = {
  /** What would run, for the placeholder's accessible name. */
  label: string;
  children: ReactNode;
  /** Identifies the block: `docPath:blockHash` or `docPath:cellIndex`. */
  gateKey: string;
  /** The height the pane would have, so the page doesn't jump when it runs. */
  height?: number;
  /** Called once the code is allowed to run (now, or earlier in this page load). */
  onRun?: () => void;
};

export default function RunGate({ label, children, gateKey, height, onRun }: RunGateProps) {
  const share = useDocuments((s) => s.share);
  const [ran, setRan] = useState(() => hasRun(gateKey));
  const open = !share || ran || hasRun(gateKey);
  useEffect(() => {
    if (open) onRun?.();
  }, [open, onRun]);
  if (open) return <>{children}</>;
  return (
    <div
      className="leaf-run-gate"
      role="group"
      aria-label={label}
      style={height ? { height } : undefined}
    >
      <span>Code from {share.host.name || 'the host'}’s share runs only when you ask</span>
      <button
        type="button"
        className="leaf-button"
        onClick={() => {
          markRun(gateKey);
          setRan(true);
        }}
      >
        Run
      </button>
    </div>
  );
}
