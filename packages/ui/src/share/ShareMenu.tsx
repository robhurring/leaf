import { useEffect, useRef, useState } from 'react';
import { Check, Share, X } from '../icons/index.js';
import { inTab } from '../source/TauriSource.js';
import { onShare } from './bridge.js';
import { useDocuments } from '../store/documents.js';
import { useShare } from './store.js';

/** The toolbar's Share button: starts, resumes and ends this tab's share and hands out its links. */
export function ShareMenu() {
  const relayUrl = useDocuments((s) => s.config?.relayUrl);
  const active = inTab() && !!relayUrl;
  const { state, error: alert, ended, copied } = useShare();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const off = onShare((s) => useShare.getState().apply(s));
    void useShare.getState().load();
    return off;
  }, [active]);
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

  const sharing = state?.status === 'live' || state?.status === 'reconnecting';
  const resumable = !sharing && !!state?.resumable;
  useEffect(() => {
    if (!sharing && !resumable) setOpen(false);
  }, [sharing, resumable]);
  if (!active) return null;
  const viewers = state?.viewers ?? [];
  const act = (fn: () => Promise<void>) => {
    setOpen(false);
    void fn();
  };
  const flash = (which: 'app' | 'web') =>
    copied?.which !== which ? undefined : copied.ok ? <Check size={14} /> : <X size={14} />;
  const { start, resume, end, copy } = useShare.getState();

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
            onClick={() => void copy('app')}
          >
            Copy app link
            {flash('app')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="leaf-menu-item"
            onClick={() => void copy('web')}
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

export default ShareMenu;
