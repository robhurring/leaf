// Settings: for now, which kinds of link the app window opens in other apps.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_LINK_SCHEMES } from '@leaf/protocol';
import { useUi } from '../store/ui.js';
import { X } from '../icons/index.js';

/** Kinds that run code rather than open an app; the core never opens them either. */
const NEVER = new Set(['javascript', 'vbscript', 'data', 'blob', 'file', 'about']);

/** `Obsidian://`, ` obsidian: ` → `obsidian`; or why it can't be a link kind. */
function parseScheme(raw: string): { scheme: string } | { error: string } {
  const scheme = raw
    .trim()
    .toLowerCase()
    .replace(/:(\/\/)?$/, '');
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme))
    return { error: 'A link kind is the part before the colon: letters, digits, + - or .' };
  if (NEVER.has(scheme)) return { error: `${scheme}: links never open; they can run code.` };
  return { scheme };
}

export function Settings({ onClose }: { onClose(): void }) {
  const schemes = useUi((s) => s.linkSchemes);
  const setSchemes = useUi((s) => s.setLinkSchemes);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseScheme(draft);
    if ('error' in parsed) return setError(parsed.error);
    setError(null);
    setDraft('');
    if (!schemes.includes(parsed.scheme)) setSchemes([...schemes, parsed.scheme]);
    input.current?.focus();
  };

  return (
    <div
      className="leaf-modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="leaf-settings" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="leaf-settings-head">
          <h2>Settings</h2>
          <button
            type="button"
            className="leaf-ib leaf-ib-sm"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>
        <section className="leaf-settings-section" aria-labelledby="leaf-settings-links">
          <h3 id="leaf-settings-links">Links to other apps</h3>
          <p className="leaf-settings-hint">
            In the leaf window, links of these kinds open in the app your Mac has for them: your
            browser, mail, or editor. In a browser tab, the browser decides.
          </p>
          <ul className="leaf-settings-kinds" aria-label="Allowed link kinds">
            {schemes.map((s) => (
              <li key={s} className="leaf-pill">
                {s}
                <button
                  type="button"
                  aria-label={`Remove ${s}`}
                  title={`Remove ${s}`}
                  onClick={() => setSchemes(schemes.filter((x) => x !== s))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <form className="leaf-settings-add" onSubmit={add}>
            <input
              ref={input}
              aria-label="Add a link kind"
              placeholder="obsidian"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
            />
            <button type="submit" className="leaf-button">
              Add
            </button>
            <button
              type="button"
              className="leaf-button leaf-button-quiet"
              onClick={() => {
                setSchemes([...DEFAULT_LINK_SCHEMES]);
                setError(null);
              }}
            >
              Restore defaults
            </button>
          </form>
          {error && (
            <p className="leaf-settings-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
