import type { SourceStatus } from '../source/DocumentSource.js';

const LABEL: Record<SourceStatus, string> = {
  connecting: 'Connecting',
  open: 'Connected, live updates on',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected',
};

export function ConnectionDot({ status }: { status: SourceStatus }) {
  return (
    <span
      className="leaf-dot"
      data-status={status}
      role="status"
      aria-label={LABEL[status]}
      title={LABEL[status]}
    />
  );
}
