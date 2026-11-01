import { useEffect, useRef, useState } from 'react';
import { Check, Share, X } from '../icons/index.js';
import { inTab, onShare } from '../source/TauriSource.js';
import { useDocuments } from '../store/documents.js';
import { useShare } from './store.js';

type Copied = { which: 'app' | 'web'; ok: boolean } | null;

/** The toolbar's Share button: starts, resumes and ends this tab's share and hands out its links. */
export function ShareMenu() {
  const relayUrl = useDocuments((s) => s.config?.relayUrl);
  const active = inTab() && !!relayUrl;
  const { state, error } = useShare();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const [ended, setEnded] = useState(false);
  const [alert, setAlert] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    void useShare.getState().load();
    return onShare((s) => {
      useShare.setState({ state: s });
      if (s.status === 'ended') setEnded(true);
    });
  }, [active]);
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => setEnded(false), 4000);
    return () => clearTimeout(t);
  }, [ended]);
  useEffect(() => {
    setAlert(error);
    if (!error) return;
    const t = setTimeout(() => setAlert(null), 4000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!active) return null;
  const sharing = state?.status === 'live' || state?.status === 'reconnecting';
  const resumable = !sharing && !!state?.resumable;
  const viewers = state?.viewers ?? [];
  const act = (fn: () => Promise<void>) => {
    setOpen(false);
    void fn();
  };
  const copy = (which: 'app' | 'web') => {
    const url = which === 'app' ? state?.appUrl : state?.webUrl;
    navigator.clipboard.writeText(url ?? '').then(
      () => setCopied({ which, ok: true }),
      () => setCopied({ which, ok: false }),
    );
  };
  const flash = (which: 'app' | 'web') =>
    copied?.which !== which ? undefined : copied.ok ? <Check size={14} /> : <X size={14} />;
  const { start, resume, end } = useShare.getState();

  return (
    <div className="leaf-menu-host leaf-share" ref={ref}>
      <button
        type="button"
        className="leaf-tool"
        aria-label={sharing ? 'Sharing' : 'Share this tab'}
        title={
          alert
            ? alert
            : state?.status === 'reconnecting'
              ? 'Reconnecting to the relay…'
              : sharing
                ? 'Sharing'
                : 'Share this tab'
        }
        data-status={state?.status === 'reconnecting' ? 'reconnecting' : undefined}
        aria-haspopup={sharing || resumable ? 'menu' : undefined}
        aria-expanded={sharing || resumable ? open : undefined}
        onClick={() => (sharing || resumable ? setOpen((o) => !o) : void start())}
      >
        <Share size={15} />
        {sharing && viewers.length > 0 && (
          <span className="leaf-share-badge">{viewers.length}</span>
        )}
      </button>
      {open && sharing && (
        <div className="leaf-menu" role="menu" aria-label="Sharing">
          <button
            type="button"
            role="menuitem"
            className="leaf-menu-item"
            onClick={() => copy('app')}
          >
            Copy app link
            {flash('app')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="leaf-menu-item"
            onClick={() => copy('web')}
          >
            Copy web link
            {flash('web')}
          </button>
          <button type="button" role="menuitem" className="leaf-menu-item" onClick={() => act(end)}>
            End session
          </button>
          <div className="leaf-menu-sep" />
          <div className="leaf-menu-group" role="group" aria-label="Watching">
            {viewers.map((v) => (
              <div key={v.id} className="leaf-share-viewer">
                <span className="leaf-share-dot" style={{ background: v.color }} />
                {v.name}
              </div>
            ))}
          </div>
        </div>
      )}
      {open && resumable && (
        <div className="leaf-menu" role="menu" aria-label="Share this tab">
          <button
            type="button"
            role="menuitem"
            className="leaf-menu-item"
            onClick={() => act(resume)}
          >
            Resume sharing
          </button>
          <button
            type="button"
            role="menuitem"
            className="leaf-menu-item"
            onClick={() => act(start)}
          >
            Share this tab
          </button>
        </div>
      )}
      {alert && (
        <div className="leaf-share-note" role="alert">
          {alert}
        </div>
      )}
      {ended && !sharing && (
        <div className="leaf-share-note" role="status">
          Sharing ended
        </div>
      )}
    </div>
  );
}
