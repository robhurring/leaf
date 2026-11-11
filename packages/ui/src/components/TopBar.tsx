import {
  Check,
  Chevron,
  LeafMark,
  Numbering,
  Outline as OutlineIcon,
  Search,
  Share,
  Sidebar,
} from '../icons/index.js';
import type { Peer } from '@leaf/protocol';
import { AvatarStack } from '../share/Avatar.js';
import type { SourceStatus } from '../source/DocumentSource.js';
import type { Appearance, Theme } from '../store/ui.js';
import { ConnectionDot } from './ConnectionDot.js';
import { IconButton } from './IconButton.js';
import { TextSize } from './TextSize.js';
import { ThemeMenu } from './ThemeMenu.js';

export type TopBarProps = {
  title: string;
  path: string;
  treeAvailable: boolean;
  treeOpen: boolean;
  outlineAvailable?: boolean;
  outlineOpen: boolean;
  numbering: boolean;
  textPct: number;
  theme: Theme;
  appearance: Appearance;
  status: SourceStatus;
  onToggleTree(): void;
  onToggleOutline(): void;
  onToggleNumbering(): void;
  onBumpText(delta: -10 | 0 | 10): void;
  /** Running in the app window. */
  native?: boolean;
  onTheme(t: Theme): void;
  onAppearance(a: Appearance): void;
  onSettings?(): void;
  onSearch(): void;
  /** The open Go to field, shown in place of its button. */
  goto?: React.ReactNode;
  onTitle(): void;
  /** Shows the app's own appearance menu instead of the dropdown. */
  onAppearanceMenu?(): void;
  /** Extra handlers for the leaf mark: in a one-tab window it drags the tab. */
  brand?: React.HTMLAttributes<HTMLButtonElement>;
  /** The active tab's share, for the Share button; absent when this leaf can't share. */
  share?: ShareState;
  onShare?(): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?(): void;
  onForward?(): void;
};

/** What the Share button shows: the tab's share, and a check just after a link is copied. */
export type ShareState = {
  status: 'idle' | 'live' | 'reconnecting' | 'ended';
  viewers: Peer[];
  copied?: boolean;
};

/** The Share button: sharing the active tab, who is watching, and a check after a copy.
 * The app answers the click itself (a share, or its own menu). */
export function ShareButton({ share, onClick }: { share: ShareState; onClick(): void }) {
  const sharing = share.status === 'live' || share.status === 'reconnecting';
  const label = sharing ? 'Sharing' : 'Share this tab';
  return (
    <button
      type="button"
      className="leaf-ib leaf-share-button"
      aria-label={label}
      title={share.status === 'reconnecting' ? 'Reconnecting to the relay…' : label}
      data-status={share.status === 'reconnecting' ? 'reconnecting' : undefined}
      data-copied={share.copied ? 'true' : undefined}
      onClick={onClick}
    >
      {share.copied ? <Check /> : <Share />}
      {sharing && <AvatarStack peers={share.viewers} />}
    </button>
  );
}

export function TopBar(p: TopBarProps) {
  // In the app window the bar moves the window. Tauri drags only from the element pressed,
  // so each empty area is marked; controls are not.
  const drag = p.native ? { 'data-tauri-drag-region': '' } : {};
  return (
    <header className={`leaf-bar ${p.native ? 'leaf-bar-native' : ''}`} role="banner" {...drag}>
      <div className="leaf-bar-left" {...drag}>
        {p.treeAvailable && (
          <IconButton label="Toggle files" pressed={p.treeOpen} onClick={p.onToggleTree}>
            <Sidebar />
          </IconButton>
        )}
        <button
          type="button"
          className="leaf-brand"
          onClick={p.onTitle}
          title="Back to top"
          {...p.brand}
        >
          <LeafMark size={20} className="leaf-mark" />
          <span className="leaf-wordmark">leaf</span>
        </button>
        {p.onBack && (
          <div className="leaf-history" role="group" aria-label="History">
            <IconButton
              label="Back (⌘[)"
              disabled={!p.canGoBack}
              onClick={p.onBack}
              className="leaf-history-back"
            >
              <Chevron size={16} />
            </IconButton>
            <IconButton label="Forward (⌘])" disabled={!p.canGoForward} onClick={p.onForward}>
              <Chevron size={16} />
            </IconButton>
          </div>
        )}
      </div>
      <div className="leaf-bar-center" {...drag}>
        {p.goto ?? (
          <button type="button" className="leaf-search" onClick={p.onSearch} aria-label="Go to">
            <Search size={14} />
            <span>Go to…</span>
            <kbd>⌘K</kbd>
          </button>
        )}
      </div>
      <div className="leaf-bar-right" {...drag}>
        <TextSize pct={p.textPct} onBump={p.onBumpText} />
        {/* Headings only exist in markdown. */}
        {p.outlineAvailable !== false && (
          <>
            <IconButton label="Number headings" pressed={p.numbering} onClick={p.onToggleNumbering}>
              <Numbering />
            </IconButton>
            <IconButton label="Toggle outline" pressed={p.outlineOpen} onClick={p.onToggleOutline}>
              <OutlineIcon />
            </IconButton>
          </>
        )}
        {p.share && p.onShare && <ShareButton share={p.share} onClick={p.onShare} />}
        <ThemeMenu
          native={p.native}
          theme={p.theme}
          appearance={p.appearance}
          onTheme={p.onTheme}
          onAppearance={p.onAppearance}
          onSettings={p.onSettings}
          onOpenMenu={p.onAppearanceMenu}
        />
        {/* In the app the core is in-process: always connected, so no dot. */}
        {!p.native && <ConnectionDot status={p.status} />}
      </div>
    </header>
  );
}
