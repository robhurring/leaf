// A share's viewer: a line above the document naming the host, who's here, and what the
// host is reading; when the share ends, a notice in the document's place.
import { useDocuments } from '../store/documents.js';

const ENDED: Record<string, (host: string) => string> = {
  host: (host) => `${host} ended the share`,
  'host-gone': (host) => `${host}’s leaf went away`,
  'forbidden-path': () => 'You were disconnected from this share',
};

export type ShareBannerProps = {
  /** The document open here. */
  path: string;
  /** The router's base, for the link's address. */
  base: string;
  onOpen(path: string): void;
  /** The ended notice, shown in the document's place. */
  ended?: boolean;
};

export default function ShareBanner({ path, base, onOpen, ended }: ShareBannerProps) {
  const share = useDocuments((s) => s.share);
  const presence = useDocuments((s) => s.presence);
  const status = useDocuments((s) => s.shareStatus);
  const reason = useDocuments((s) => s.shareReason);
  if (!share) return null;
  const host = share.host.name || 'The host';

  if (ended)
    return (
      <div className="leaf-doc-state" role="status">
        <p className="leaf-doc-state-title">{(ENDED[reason ?? ''] ?? ENDED.host!)(host)}</p>
        <p className="leaf-doc-state-detail">{share.id}</p>
      </div>
    );

  const count = presence?.viewers.length;
  const hostPath = presence?.hostPath;
  return (
    <div className="leaf-share-banner" role="region" aria-label="Share">
      <span className="leaf-share-dot" style={{ background: share.host.color }} />
      {status === 'reconnecting' ? (
        <span>Reconnecting to {host}…</span>
      ) : (
        <>
          <span>
            {host}’s share · {share.id}
            {count !== undefined && ` · ${count} here`}
          </span>
          {hostPath && hostPath !== path && (
            <a
              href={`${base}/${hostPath.split('/').map(encodeURIComponent).join('/')}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                onOpen(hostPath);
              }}
            >
              {host} is reading {hostPath}
            </a>
          )}
        </>
      )}
    </div>
  );
}
