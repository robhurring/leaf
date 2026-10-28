import { useEffect, useRef, useState } from 'react';
import { Appearance as AppearanceIcon } from '../icons/index.js';
import { THEMES, type Appearance, type Theme } from '../store/ui.js';
import { IconButton } from './IconButton.js';

type Props = {
  /** In the app window: one look, so no theme group, and auto reads as System. */
  native?: boolean;
  theme: Theme;
  appearance: Appearance;
  onTheme(t: Theme): void;
  onAppearance(a: Appearance): void;
};

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];
const THEME_LABEL: Record<Theme, string> = {
  github: 'GitHub',
  glass: 'Glass',
  card: 'Card',
  paper: 'Paper',
};

export function ThemeMenu({ native = false, theme, appearance, onTheme, onAppearance }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div className="leaf-menu-host" ref={ref}>
      <IconButton
        label="Appearance"
        pressed={open}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AppearanceIcon />
      </IconButton>
      {open && (
        <div className="leaf-menu" role="menu" aria-label="Appearance and theme">
          <div className="leaf-menu-group" role="group" aria-label="Appearance">
            {APPEARANCES.map((a) => (
              <button
                key={a.value}
                type="button"
                role="menuitemradio"
                aria-checked={appearance === a.value}
                className="leaf-menu-item"
                onClick={() => onAppearance(a.value)}
              >
                {native && a.value === 'auto' ? 'System' : a.label}
              </button>
            ))}
          </div>
          {!native && <div className="leaf-menu-sep" />}
          {!native && (
            <div className="leaf-menu-group" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === t}
                  className="leaf-menu-item"
                  onClick={() => onTheme(t)}
                >
                  {THEME_LABEL[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
