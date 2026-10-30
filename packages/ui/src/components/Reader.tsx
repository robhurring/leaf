// The full reader: title bar, files, document, outline, palette. Bound to any
// DocumentSource; UI state is sticky by default and controllable by the host.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '@leaf/protocol';
import type { Handlers } from '../render/handlers.js';
import type { Heading } from '../render/headings.js';
import { createRouter } from '../router.js';
import { installShortcuts } from '../shortcuts.js';
import { registerCommands, runCommand } from '../commands.js';
import {
  inTab,
  inTauri,
  reportTabState,
  selectTab,
  windowTabs,
  tauriWindowLabel,
  windowReady,
} from '../source/TauriSource.js';
import { listen } from '@tauri-apps/api/event';
import type { DocumentSource } from '../source/DocumentSource.js';
import { useDocuments } from '../store/documents.js';
import { applyTheme, followOtherTabs, useUi, type Appearance, type Theme } from '../store/ui.js';
import { DocumentView } from './DocumentView.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { Outline } from './Outline.js';
import { GoTo, type GoToMode, type GoToTab } from './GoTo.js';
import { Resizer } from './Resizer.js';
import { FindBar } from './FindBar.js';
import { usePresence, type Presence } from '../usePresence.js';
import { DocToolsContext, Properties } from './Properties.js';
import { Stage } from '../stage/Stage.js';
import { useStage } from '../store/stage.js';
import { ProgressBar } from './ProgressBar.js';
import { BlameMargin } from './BlameMargin.js';
import { BlameResizer, BlameShownContext } from './BlameColumn.js';
import { Settings } from './Settings.js';
import { NoticeBar } from './NoticeBar.js';
import { createPortal } from 'react-dom';
import { isMarp } from '../viewers/deck/detect.js';
import { useDeckMode } from '../store/deckMode.js';
import { Check, Code, Copy, File, Slides, X } from '../icons/index.js';
import { SourceView } from './SourceView.js';

const SpeakerView = lazy(() => import('../viewers/deck/SpeakerView.js'));
/** A deck's speaker window, opened with ?speaker. Read once, before the router rewrites the address. */
const SPEAKER_WINDOW =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('speaker');
import { AppearanceContext, useResolvedAppearance } from '../viewers/appearance.js';
import { AssetContext, rawUrl, type AssetResolver } from '../render/components/assetContext.js';
import { useAssets } from '../store/assets.js';
import { TopBar } from './TopBar.js';
import { Tree } from './Tree.js';
import { NumberingContext } from '../render/components/Heading.js';
import { Markdown } from './Markdown.js';
import { viewers } from '../viewers/index.js';
import { mentionUrlFor } from '../render/inline/mention.js';

export type ReaderProps = {
  source: DocumentSource;
  base?: string;
  handlers?: Handlers;
  theme?: Theme;
  appearance?: Appearance;
  treeOpen?: boolean;
  onTreeOpenChange?(open: boolean): void;
  outlineOpen?: boolean;
  onOutlineOpenChange?(open: boolean): void;
  numbering?: boolean;
  onNumberingChange?(on: boolean): void;
  path?: string;
  onPathChange?(path: string): void;
};

/** Files the palette can offer: everything loaded in the tree plus the server's search matches. */
function allKnownFiles(tree: Record<string, Entry[]>, matches: Entry[]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const e of [...Object.values(tree).flat(), ...matches])
    if (e.kind === 'file') seen.set(e.path, e);
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const DEFAULT_DOCS = ['README.md', 'readme.md', 'index.md', 'INDEX.md'];

function defaultDocument(entries: Entry[]): string | null {
  const files = entries.filter((e) => e.kind === 'file');
  for (const name of DEFAULT_DOCS) {
    const hit = files.find((f) => f.name === name);
    if (hit) return hit.path;
  }
  return files.find((f) => /\.(md|markdown)$/i.test(f.name))?.path ?? files[0]?.path ?? null;
}

export function Reader(props: ReaderProps) {
  const { source, base = '', handlers } = props;
  const router = useMemo(() => createRouter(base), [base]);
  const ui = useUi();
  const docs = useDocuments();
  const [goto, setGoto] = useState<GoToMode | null>(null);
  const [toolsEl, setToolsEl] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [find, setFind] = useState<{ q: string; index: number; key: number } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // A hash to scroll to after the next render, consumed once so live re-renders never re-scroll.
  const pendingSlug = useRef<string | null>(null);

  // Controlled props win over the sticky store.
  const treeOpen = props.treeOpen ?? ui.treeOpen;
  const outlineOpen = props.outlineOpen ?? ui.outlineOpen;
  const numbering = props.numbering ?? ui.numbering;
  const native = inTauri();
  // In a tab of an app window the window's chrome holds the title row.
  const tabbed = inTab();
  const theme = props.theme ?? ui.theme;
  const appearance = props.appearance ?? ui.appearance;
  const resolved = useResolvedAppearance(appearance);
  // Assets: the server's /raw URLs when it has them, else bytes over the socket.
  const assetUrls = useAssets((s) => s.urls);
  const rawUrls = docs.capabilities?.rawUrls === true;
  const assetResolver = useCallback<AssetResolver>(
    (path) => {
      if (rawUrls) return rawUrl(path);
      const url = assetUrls[path];
      if (url) return url;
      useAssets.getState().request(path);
      return null;
    },
    [rawUrls, assetUrls],
  );

  const setTreeOpen = (v: boolean) => (props.onTreeOpenChange ?? ui.setTreeOpen)(v);
  const setOutlineOpen = (v: boolean) => (props.onOutlineOpenChange ?? ui.setOutlineOpen)(v);
  const setNumbering = (v: boolean) => (props.onNumberingChange ?? ui.setNumbering)(v);

  useEffect(() => {
    applyTheme(document.documentElement, native ? 'native' : theme, resolved, ui.textPct);
    // The app window styles its chrome like a Mac app (see "app window" in leaf.css).
    if (native) document.documentElement.dataset.shell = 'app';
  }, [theme, resolved, ui.textPct]);
  useEffect(() => docs.attach(source), [source]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useCallback(
    (target: string, replace = false) => {
      const [path, slug] = target.split('#', 2);
      const p = path ?? '';
      // A server that went away while the page sat idle shows as disconnected right away.
      source.check?.();
      (replace ? router.replace : router.push)(p, slug);
      props.onPathChange?.(p);
      useDocuments.getState().open(p);
      pendingSlug.current = slug ?? null;
      if (!slug) mainRef.current?.scrollTo?.({ top: 0 });
    },
    [router, source, props.onPathChange], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Initial document: the URL's path, the controlled prop, or the folder's README.
  const rootEntries = docs.tree[''];
  useEffect(() => {
    if (!docs.root || !rootEntries || docs.path !== null) return;
    const fromUrl = props.path ?? router.current().path;
    const target =
      fromUrl || (docs.root.kind === 'file' ? rootEntries[0]?.path : defaultDocument(rootEntries));
    if (target)
      navigate(`${target}${router.current().slug ? '#' + router.current().slug : ''}`, true);
  }, [docs.root, rootEntries, docs.path, props.path, router, navigate]);

  useEffect(() => router.subscribe((loc) => useDocuments.getState().open(loc.path)), [router]);
  const [reach, setReach] = useState({ back: false, forward: false });
  useEffect(() => {
    const update = () => setReach({ back: router.canGoBack(), forward: router.canGoForward() });
    update();
    return router.onHistory(update);
  }, [router]);

  useEffect(() => {
    if (props.path !== undefined && props.path !== docs.path) navigate(props.path, true);
  }, [props.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback(
    (slug: string) => {
      router.replace(docs.path ?? '', slug);
      document.getElementById(slug)?.scrollIntoView({ block: 'start' });
    },
    [router, docs.path],
  );

  const toggleAppearance = () => ui.setAppearance(resolved === 'dark' ? 'light' : 'dark');

  // A folder gets a tree unless it holds a single file (nothing to choose between).
  const treeAvailable =
    docs.root?.kind === 'dir' &&
    (rootEntries?.length ?? 0) > 0 &&
    !(rootEntries?.length === 1 && rootEntries[0]?.kind === 'file');
  // A folder whose top has nothing to open: say so instead of waiting forever.
  const nothingToOpen =
    docs.root?.kind === 'dir' &&
    rootEntries !== undefined &&
    docs.path === null &&
    defaultDocument(rootEntries) === null;

  // Every control is a named command; shortcuts, the bar, and native menus all run these.
  useEffect(() =>
    registerCommands({
      toggleTree: () => setTreeOpen(!treeOpen),
      toggleOutline: () => setOutlineOpen(!outlineOpen),
      toggleNumbering: () => setNumbering(!numbering),
      toggleAppearance,
      setAppearance: (a: Appearance) => ui.setAppearance(a),
      openPalette: () => setGoto('all'),
      openFiles: () => {
        if (treeAvailable) setGoto('files');
      },
      openFind: (arg?: { q: string; index?: number }) =>
        setFind((f) => ({
          q: arg?.q ?? f?.q ?? '',
          index: arg?.index ?? 0,
          key: (f?.key ?? 0) + 1,
        })),
      closeOverlays: () => {
        setGoto(null);
        setFind(null);
      },
      scrollBy: (arg: { unit: 'line' | 'half' | 'page'; direction: 1 | -1 }) => {
        const el = mainRef.current;
        if (!el || !arg) return;
        const amount =
          arg.unit === 'line'
            ? 60
            : arg.unit === 'half'
              ? Math.round(el.clientHeight / 2)
              : el.clientHeight - 60;
        el.scrollBy({ top: amount * arg.direction });
      },
      jumpHeading: (direction: 1 | -1) => {
        const main = mainRef.current;
        if (!main) return;
        const top = main.getBoundingClientRect().top;
        const all = [...main.querySelectorAll<HTMLElement>('article .leaf-heading[id]')];
        // A heading jumped to rests its scroll margin below the top; measure from there,
        // or ctrl-n would pick the same heading again.
        const offset = (h: HTMLElement) =>
          h.getBoundingClientRect().top -
          top -
          (parseFloat(getComputedStyle(h).scrollMarginTop) || 0);
        const target =
          direction === 1
            ? all.find((h) => offset(h) > 4)
            : [...all].reverse().find((h) => offset(h) < -4);
        if (target) jump(target.id);
      },
      textLarger: () => ui.bumpText(10),
      textSmaller: () => ui.bumpText(-10),
      textReset: () => ui.bumpText(0),
      openSettings: () => setSettingsOpen(true),
      // A leaf:// link the app routed to this window.
      openPath: (arg?: { path: string; slug?: string }) => {
        if (arg) navigate(arg.slug ? `${arg.path}#${arg.slug}` : arg.path);
      },
      goBack: () => router.back(),
      goForward: () => router.forward(),
      // The leaf mark in the window's title row.
      scrollTop: () => mainRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' }),
    }),
  );

  useEffect(() =>
    installShortcuts(
      {
        toggleTree: () => runCommand('toggleTree'),
        toggleOutline: () => runCommand('toggleOutline'),
        toggleNumbering: () => runCommand('toggleNumbering'),
        toggleAppearance: () => runCommand('toggleAppearance'),
        openPalette: () => runCommand('openPalette'),
        openFiles: () => runCommand('openFiles'),
        openFind: () => runCommand('openFind'),
        closeOverlays: () => runCommand('closeOverlays'),
        scrollBy: (unit, direction) => runCommand('scrollBy', { unit, direction }),
        jumpHeading: (direction) => runCommand('jumpHeading', direction),
        openSettings: () => runCommand('openSettings'),
        goBack: () => runCommand('goBack'),
        goForward: () => runCommand('goForward'),
      },
      window,
      () => useStage.getState().open !== null,
    ),
  );

  // In the app window, native menu items arrive as events naming a command.
  useEffect(() => {
    if (!native) return;
    let off: (() => void) | undefined;
    let gone = false;
    // Targeted at this webview: a plain listen() would also hear other windows' commands.
    void listen<{ name: string; arg?: unknown }>(
      'leaf://command',
      (e) => runCommand(e.payload.name, e.payload.arg),
      { target: { kind: 'WebviewWindow', label: tauriWindowLabel() } },
    ).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, [native]);

  const path = docs.path ?? '';
  const file = docs.files[path];
  const error = docs.errors[path];
  const h1 = docs.headings.find((h) => h.depth === 1);
  const title =
    h1?.text ?? (path ? path.slice(path.lastIndexOf('/') + 1) : (docs.root?.name ?? 'leaf'));
  // Contextual default: inside a GitHub/GitLab repo, @mentions link to that host unless configured.
  const config = useMemo(
    () => ({
      ...docs.config,
      mentionUrl: docs.config.mentionUrl ?? mentionUrlFor(file?.git?.repoUrl),
    }),
    [docs.config, file?.git?.repoUrl],
  );
  // A markdown file with `marp: true` shows as slides unless switched to a document.
  const marp =
    !!file &&
    viewers.forFile(file).id === 'markdown' &&
    file.encoding === 'utf8' &&
    isMarp(file.content ?? '');
  const speaker = SPEAKER_WINDOW;
  const readAsDocument = useDeckMode((s) => (file ? !!s.documents[file.path] : false));
  // A markdown page (a deck read as a document too) flips to its source, and copies it.
  const [sourceOf, setSourceOf] = useState<string | null>(null);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const isMarkdown = file
    ? viewers.forFile(file).id === 'markdown' &&
      file.encoding === 'utf8' &&
      !(marp && !readAsDocument)
    : false;
  const markdownSource = isMarkdown && sourceOf === file?.path;

  const onRendered = useCallback(
    (info: { headings: Heading[]; frontmatter?: Record<string, unknown> }) => {
      useDocuments.getState().setHeadings(info.headings, info.frontmatter);
      const slug = pendingSlug.current;
      if (slug) {
        pendingSlug.current = null;
        requestAnimationFrame(() =>
          document.getElementById(slug)?.scrollIntoView({ block: 'start' }),
        );
      }
    },
    [],
  );

  const findRoot = useCallback(
    () => mainRef.current?.querySelector('article') ?? mainRef.current ?? null,
    [],
  );
  const findScroller = useCallback(() => mainRef.current, []);
  const searchFiles = useCallback((q: string) => useDocuments.getState().search(q), []);
  const searchText = useCallback((q: string) => useDocuments.getState().searchText(q), []);
  // The app window opens hidden: show it once the first document has painted, or shortly
  // anyway when there is none to wait for.
  useEffect(() => {
    if (!native) return;
    if (!file) {
      const t = setTimeout(windowReady, 600);
      return () => clearTimeout(t);
    }
    const f = requestAnimationFrame(() => requestAnimationFrame(windowReady));
    return () => cancelAnimationFrame(f);
  }, [native, file]);

  // Blame: for markdown and code files in git; diagrams and the rest don't show it.
  const blameAvailable =
    !!file?.git && (isMarkdown || (file !== undefined && viewers.forFile(file).id === 'code'));
  const blameOn = blameAvailable && ui.blame;
  const blame = useDocuments((s) => (file ? s.blame[file.path] : undefined));
  useEffect(() => {
    if (blameOn && path) useDocuments.getState().requestBlame(path);
  }, [blameOn, path]);
  const [markdownHost, setMarkdownHost] = useState<HTMLDivElement | null>(null);
  const blameShown = blameOn ? { width: ui.blameWidth } : null;

  // Only markdown has an outline; other files hide it without touching the saved setting.
  const outlineAvailable = !file || isMarkdown;
  const outlineOn = outlineAvailable && outlineOpen;
  const treeShown = usePresence(treeAvailable && treeOpen);
  const outlineShown = usePresence(outlineOn);

  // ⌘K lists the window's other tabs; asked for each time it opens.
  const [otherTabs, setOtherTabs] = useState<GoToTab[]>([]);
  useEffect(() => {
    if (tabbed && goto) void windowTabs().then(setOtherTabs);
  }, [tabbed, goto]);

  // In a tab, the window's title row shows this tab's state, and the tab follows the
  // settings other tabs change.
  useEffect(() => {
    if (!tabbed) return;
    reportTabState({
      title,
      path,
      canBack: reach.back,
      canForward: reach.forward,
      treeAvailable,
      treeOpen,
      outlineAvailable,
      outlineOpen,
      numbering,
      textPct: ui.textPct,
      theme,
      appearance,
      status: docs.status,
    });
  }, [
    tabbed,
    title,
    path,
    reach.back,
    reach.forward,
    treeAvailable,
    treeOpen,
    outlineAvailable,
    outlineOpen,
    numbering,
    ui.textPct,
    theme,
    appearance,
    docs.status,
  ]);
  useEffect(() => {
    if (!tabbed) return;
    document.documentElement.dataset.tab = '';
    return followOtherTabs();
  }, [tabbed]);

  // A deck's speaker window (opened from the deck with ?speaker): only the speaker view.
  if (speaker && marp && file)
    return (
      <AppearanceContext.Provider value={resolved}>
        <AssetContext.Provider value={assetResolver}>
          <div className="leaf-app leaf-speaker-app">
            <Suspense fallback={null}>
              <SpeakerView content={file.content ?? ''} docPath={file.path} />
            </Suspense>
          </div>
        </AssetContext.Provider>
      </AppearanceContext.Provider>
    );

  const gotoBox = goto && (
    <GoTo
      mode={goto}
      headings={docs.headings}
      files={treeAvailable ? allKnownFiles(docs.tree, docs.matches) : []}
      numbering={numbering}
      docRoot={findRoot}
      onSearch={searchFiles}
      hits={docs.textHits}
      currentPath={docs.path}
      onSearchText={searchText}
      onOpenAt={(p, q) => {
        navigate(p);
        runCommand('openFind', { q });
      }}
      onJump={jump}
      onOpen={(p) => navigate(p)}
      onFind={(q, index) => runCommand('openFind', { q, index })}
      onClose={() => setGoto(null)}
      tabs={tabbed ? otherTabs : undefined}
      onTab={selectTab}
    />
  );

  return (
    <AppearanceContext.Provider value={resolved}>
      <AssetContext.Provider value={assetResolver}>
        <div
          className={`leaf-app ${treeAvailable && treeOpen ? '' : 'leaf-no-tree'} ${outlineOn ? '' : 'leaf-no-outline'}`}
          style={
            {
              '--leaf-tree-w': `${ui.treeWidth}px`,
              '--leaf-outline-w': `${ui.outlineWidth}px`,
            } as React.CSSProperties
          }
        >
          <ProgressBar />
          {tabbed ? (
            gotoBox && <div className="leaf-tab-goto">{gotoBox}</div>
          ) : (
            <TopBar
              canGoBack={reach.back}
              canGoForward={reach.forward}
              onBack={() => runCommand('goBack')}
              onForward={() => runCommand('goForward')}
              title={title}
              path={path}
              treeAvailable={treeAvailable}
              treeOpen={treeOpen}
              outlineAvailable={outlineAvailable}
              outlineOpen={outlineOpen}
              numbering={numbering}
              textPct={ui.textPct}
              theme={theme}
              appearance={appearance}
              status={docs.status}
              onToggleTree={() => setTreeOpen(!treeOpen)}
              onToggleOutline={() => setOutlineOpen(!outlineOpen)}
              onToggleNumbering={() => setNumbering(!numbering)}
              onBumpText={ui.bumpText}
              native={native}
              onTheme={ui.setTheme}
              onAppearance={ui.setAppearance}
              onSettings={() => runCommand('openSettings')}
              onSearch={() => setGoto('all')}
              goto={gotoBox}
              onTitle={() => mainRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })}
            />
          )}
          <div className="leaf-body">
            {treeShown && <Tree state={treeShown} onOpen={(p) => navigate(p)} />}
            {treeAvailable && treeOpen && <Resizer side="tree" />}
            <div className="leaf-doc-col">
              {file && (
                <Properties
                  file={file}
                  frontmatter={docs.frontmatter}
                  toolsRef={setToolsEl}
                  blame={
                    blameAvailable
                      ? {
                          on: ui.blame,
                          onToggle: () => ui.setBlame(!ui.blame),
                        }
                      : undefined
                  }
                />
              )}
              <div className="leaf-main-wrap">
                {find && (
                  <FindBar
                    key={find.key}
                    initial={find.q}
                    initialIndex={find.index}
                    root={findRoot}
                    scroller={findScroller}
                    onClose={() => setFind(null)}
                  />
                )}
                <BlameShownContext.Provider value={blameShown}>
                  {marp &&
                    toolsEl &&
                    createPortal(
                      <button
                        type="button"
                        className="leaf-tool"
                        aria-label={readAsDocument ? 'Show as slides' : 'Read as a document'}
                        title={readAsDocument ? 'Show as slides' : 'Read as a document'}
                        onClick={() => useDeckMode.getState().toggle(file!.path)}
                      >
                        {readAsDocument ? <Slides size={15} /> : <File size={15} />}
                      </button>,
                      toolsEl,
                    )}
                  {isMarkdown &&
                    file &&
                    toolsEl &&
                    createPortal(
                      <>
                        <button
                          type="button"
                          className="leaf-tool"
                          aria-label="Show source"
                          title={markdownSource ? 'Back to the document' : 'Show the source'}
                          aria-pressed={markdownSource}
                          onClick={() => setSourceOf(markdownSource ? null : file.path)}
                        >
                          <Code size={15} />
                        </button>
                        <button
                          type="button"
                          className="leaf-tool"
                          aria-label="Copy source"
                          title="Copy source"
                          data-result={copied ?? undefined}
                          onClick={() =>
                            navigator.clipboard.writeText(file.content ?? '').then(
                              () => setCopied('ok'),
                              () => setCopied('failed'),
                            )
                          }
                        >
                          {copied === 'ok' ? (
                            <Check size={15} />
                          ) : copied === 'failed' ? (
                            <X size={15} />
                          ) : (
                            <Copy size={15} />
                          )}
                        </button>
                      </>,
                      toolsEl,
                    )}
                  <DocToolsContext.Provider value={file && !isMarkdown ? toolsEl : null}>
                    <main className="leaf-main" ref={mainRef}>
                      <ErrorBoundary label="document" resetKey={`${path}:${file?.mtime ?? ''}`}>
                        {markdownSource && file ? (
                          <div className="leaf-main-inner">
                            <SourceView code={file.content ?? ''} lang="markdown" label="md" />
                          </div>
                        ) : isMarkdown && file ? (
                          <div
                            className="leaf-main-inner"
                            ref={setMarkdownHost}
                            data-blame={blameShown ? '' : undefined}
                            style={
                              blameShown
                                ? ({
                                    '--leaf-blame-w': `${blameShown.width}px`,
                                  } as React.CSSProperties)
                                : undefined
                            }
                            data-viewer="markdown"
                            onClick={(e) => {
                              const a = (e.target as HTMLElement).closest?.(
                                'a[data-nav]',
                              ) as HTMLAnchorElement | null;
                              if (!a || e.metaKey || e.ctrlKey) return;
                              e.preventDefault();
                              navigate(a.dataset.nav!);
                            }}
                          >
                            <NumberingContext.Provider value={numbering}>
                              <Markdown
                                source={file.content ?? ''}
                                docPath={file.path}
                                config={config}
                                handlers={handlers}
                                numbering={numbering}
                                linkBase={base}
                                onRendered={onRendered}
                              />
                            </NumberingContext.Provider>
                            {blameShown && blame && (
                              <>
                                <BlameMargin
                                  host={markdownHost}
                                  hunks={blame.hunks}
                                  repoUrl={blame.repoUrl}
                                />
                                <BlameResizer width={blameShown.width} />
                              </>
                            )}
                          </div>
                        ) : nothingToOpen ? (
                          <div className="leaf-doc-state" role="status">
                            <p className="leaf-doc-state-title">
                              No document at the top of this folder
                            </p>
                            <p className="leaf-doc-state-detail">Pick a file from the tree.</p>
                          </div>
                        ) : (
                          <DocumentView
                            file={file}
                            error={error}
                            path={path}
                            config={config}
                            handlers={handlers}
                            numbering={numbering}
                            linkBase={base}
                            onNavigate={(t) => navigate(t)}
                          />
                        )}
                      </ErrorBoundary>
                    </main>
                  </DocToolsContext.Provider>
                </BlameShownContext.Provider>
              </div>
            </div>
            {outlineShown && (
              <Outline
                state={outlineShown}
                headings={docs.headings}
                numbering={numbering}
                onJump={jump}
              />
            )}
            {outlineOn && <Resizer side="outline" />}
          </div>
          <Stage />
          <NoticeBar />
          {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
        </div>
      </AssetContext.Provider>
    </AppearanceContext.Provider>
  );
}
