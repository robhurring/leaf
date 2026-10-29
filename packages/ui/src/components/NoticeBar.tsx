// The notice at the foot of the window: a sentence and at most one action. Goes on
// its own after a few seconds, or when its action runs.
import { useEffect } from 'react';
import { runCommand } from '../commands.js';
import { useNotice } from '../store/notice.js';

const SHOWN_MS = 8000;

export function NoticeBar() {
  const notice = useNotice((s) => s.notice);
  const clear = useNotice((s) => s.clear);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, SHOWN_MS);
    return () => clearTimeout(t);
  }, [notice, clear]);
  if (!notice) return null;
  return (
    <div className="leaf-notice" role="status" aria-label="Notice">
      <span>{notice.text}</span>
      {notice.action && (
        <button
          type="button"
          className="leaf-button"
          onClick={() => {
            clear();
            runCommand(notice.action!.command);
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button type="button" className="leaf-notice-close" aria-label="Dismiss" onClick={clear}>
        ×
      </button>
    </div>
  );
}
