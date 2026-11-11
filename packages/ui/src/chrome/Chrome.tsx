// The window's chrome in the app: the title row (the active tab's back and forward,
// Go to, and the window-wide controls) over the tab row, which shows with two or more
// tabs, or while a tab dragged from another window is over this one.
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/TopBar.js';
import { applyTheme } from '../store/ui.js';
import type { Bridge, Hover, TabInfo, TabShare, TabState } from './bridge.js';
import { TabRow } from './TabRow.js';
import { tabDragHandlers } from './useTabDrag.js';

const BLANK: TabState = {
  title: '',
  path: '',
  canBack: false,
  canForward: false,
  treeAvailable: false,
  treeOpen: false,
  outlineAvailable: false,
  outlineOpen: false,
  numbering: false,
  textPct: 100,
  theme: 'github',
  appearance: 'auto',
  status: 'open',
};

export function Chrome({ bridge, fits }: { bridge: Bridge; fits?: (s: string) => boolean }) {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [state, setState] = useState<TabState>(BLANK);
  const [hover, setHover] = useState<Hover>(null);
  // The active tab's share, for the Share button; null while this leaf can't share.
  const [share, setShare] = useState<TabShare | null>(null);
  const [copied, setCopied] = useState(false);
  const activeId = useRef<string | null>(null);
  activeId.current = tabs.find((t) => t.active)?.id ?? null;

  useEffect(() => {
    let live = true;
    const load = () => void bridge.tabs().then((t) => live && setTabs(t));
    load();
    // A tab moved here reported before this page listened: ask, unless it reports first.
    void bridge.state().then((s) => live && s && setState((now) => (now === BLANK ? s : now)));
    const offs = [bridge.onTabs(load), bridge.onHover(setHover), bridge.onTabState(setState)];
    return () => {
      live = false;
      offs.forEach((off) => off());
    };
  }, [bridge]);

  useEffect(() => {
    let live = true;
    let flash: ReturnType<typeof setTimeout> | undefined;
    // The active tab's share, read when the tabs change (the active one may have), and
    // kept up as the app reports it.
    const load = () =>
      void bridge
        .activeShare()
        .then((s) => live && setShare(s))
        .catch(() => {});
    load();
    const offs = [
      bridge.onTabs(load),
      bridge.onShare((e) => {
        if (e.tab === activeId.current) setShare(e.share);
      }),
      bridge.onCopied(() => {
        setCopied(true);
        clearTimeout(flash);
        flash = setTimeout(() => live && setCopied(false), 1500);
      }),
    ];
    return () => {
      live = false;
      clearTimeout(flash);
      offs.forEach((off) => off());
    };
  }, [bridge]);

  // The chrome wears the active tab's appearance.
  useEffect(() => {
    applyTheme(document.documentElement, 'native', state.appearance, 100);
  }, [state.appearance]);

  const here = hover?.window === bridge.windowLabel() ? hover.index : null;
  const only = tabs.length === 1 ? tabs[0]! : null;
  const send = (name: string) => () => bridge.command(name);
  return (
    <div className="leaf-chrome">
      <TopBar
        native
        {...state}
        canGoBack={state.canBack}
        canGoForward={state.canForward}
        onBack={send('goBack')}
        onForward={send('goForward')}
        onToggleTree={send('toggleTree')}
        onToggleOutline={send('toggleOutline')}
        onToggleNumbering={send('toggleNumbering')}
        onBumpText={(d) =>
          bridge.command(d === 0 ? 'textReset' : d > 0 ? 'textLarger' : 'textSmaller')
        }
        onTheme={() => {}}
        onAppearance={(a) => bridge.command('setAppearance', a)}
        onSettings={send('openSettings')}
        onAppearanceMenu={() => bridge.appearanceMenu()}
        onSearch={send('openPalette')}
        onTitle={send('scrollTop')}
        share={share ? { status: share.status, viewers: share.viewers, copied } : undefined}
        onShare={() => bridge.shareButton()}
        brand={only ? tabDragHandlers(bridge, only, 'mark') : undefined}
      />
      {(tabs.length > 1 || here !== null) && (
        <TabRow bridge={bridge} tabs={tabs} dropAt={here} fits={fits} />
      )}
    </div>
  );
}
