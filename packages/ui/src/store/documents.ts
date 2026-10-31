// Everything the UI knows about the document tree and open files. Fed only by a
// DocumentSource; components never talk to a source directly.
import { setConnection } from '../render/connection.js';
import { create } from 'zustand';
import { applyRemotePreferences, syncPreferences } from './preferences.js';
import { useAssets } from './assets.js';
import type {
  BlameHunk,
  Capabilities,
  Config,
  Entry,
  ErrorMessage,
  FileMessage,
  RootInfo,
  TextHit,
  ServerMessage,
} from '@leaf/protocol';
import type { DocumentSource, SourceStatus } from '../source/DocumentSource.js';
import type { Heading } from '../render/headings.js';

export type DocumentsState = {
  status: SourceStatus;
  root?: RootInfo;
  config: Config;
  capabilities?: Capabilities;
  path: string | null;
  tree: Record<string, Entry[]>;
  expanded: Set<string>;
  files: Record<string, FileMessage>;
  loading: Set<string>;
  errors: Record<string, ErrorMessage>;
  matches: Entry[];
  /** Lines matching the latest text search, across the folder. */
  textHits: TextHit[];
  /** True when expand-all stopped at the server's maxEntries cap. */
  expandAllCapped: boolean;
  /** Headings of the open document, reported by the markdown viewer after rendering. */
  headings: Heading[];
  frontmatter?: Record<string, unknown>;
  /** Git blame per path, once asked for: who last changed each line. */
  blame: Record<string, { hunks: BlameHunk[]; repoUrl?: string }>;

  /** Asks for `path`'s blame; it's asked again whenever the file changes. */
  requestBlame(path: string): void;
  setHeadings(headings: Heading[], frontmatter?: Record<string, unknown>): void;
  attach(source: DocumentSource): () => void;
  open(path: string): void;
  refresh(path: string): void;
  /** Keeps `path` read and re-read when it changes (a data file a document uses); returns the release. */
  watch(path: string): () => void;
  expand(dir: string): void;
  /** Opens every folder above `path`, so the tree shows it. */
  reveal(path: string): void;
  collapse(dir: string): void;
  expandAll(): void;
  collapseAll(): void;
  search(q: string): void;
  /** Text search across the folder; under two characters clears the results. */
  searchText(q: string): void;
  reset(): void;
};

let source: DocumentSource | null = null;
let stopPreferenceSync: (() => void) | null = null;
let requestId = 0;
let expandingAll = false;
const pendingReads = new Set<string>();
/** Data files in use, by how many views use each. */
const watched = new Map<string, number>();
const nextId = () => `r${++requestId}`;
let textQuery = '';

const initial = () => ({
  status: 'connecting' as SourceStatus,
  root: undefined,
  config: {},
  capabilities: undefined,
  path: null,
  tree: {},
  expanded: new Set<string>(),
  files: {},
  loading: new Set<string>(),
  errors: {},
  matches: [],
  textHits: [] as TextHit[],
  expandAllCapped: false,
  headings: [] as Heading[],
  frontmatter: undefined,
  blame: {} as Record<string, { hunks: BlameHunk[]; repoUrl?: string }>,
});

const isUnder = (path: string, dir: string) =>
  dir === '' || path === dir || path.startsWith(dir + '/');
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export const useDocuments = create<DocumentsState>((set, get) => {
  const send = (msg: Parameters<DocumentSource['send']>[0]) => source?.send(msg);

  const list = (dir: string) => send({ type: 'list', path: dir || undefined, id: nextId() });

  const read = (path: string) => {
    // Coalesce: one read in flight per path, no matter how many `changed` arrive.
    if (pendingReads.has(path)) return;
    pendingReads.add(path);
    set((s) => ({ loading: new Set(s.loading).add(path) }));
    queueMicrotask(() => send({ type: 'read', path, id: nextId() }));
  };

  const onMessage = (msg: ServerMessage) => {
    switch (msg.type) {
      case 'welcome':
        set({ root: msg.root, config: msg.config, capabilities: msg.capabilities });
        // A server that stores preferences wins over localStorage; from then on, changes flow back.
        if (msg.preferences) {
          applyRemotePreferences(msg.preferences);
          stopPreferenceSync?.();
          stopPreferenceSync = syncPreferences(send);
        }
        // The root subscription brings every tree change; loaded folders re-list themselves.
        send({ type: 'subscribe', path: '' });
        list('');
        // A reconnect: restore what the previous socket knew about.
        for (const dir of get().expanded) list(dir);
        if (get().path !== null) {
          send({ type: 'subscribe', path: get().path! });
          read(get().path!);
        }
        return;
      case 'tree':
        set((s) => ({ tree: { ...s.tree, [msg.path]: msg.entries } }));
        if (expandingAll) continueExpandAll();
        return;
      case 'file': {
        pendingReads.delete(msg.path);
        if (msg.encoding === 'base64' && msg.content !== undefined)
          useAssets.getState().store(msg.path, msg.content, msg.mime);
        set((s) => {
          const loading = new Set(s.loading);
          loading.delete(msg.path);
          const errors = { ...s.errors };
          delete errors[msg.path];
          return { files: { ...s.files, [msg.path]: msg }, loading, errors };
        });
        return;
      }
      case 'changed': {
        const { path, expanded } = get();
        const touched = [msg.path, msg.from].filter((p): p is string => p !== undefined);
        if (path !== null && touched.includes(path)) {
          if (msg.change === 'deleted' || (msg.change === 'renamed' && msg.from === path)) {
            set((s) => {
              const files = { ...s.files };
              delete files[path];
              return {
                files,
                errors: {
                  ...s.errors,
                  [path]: { type: 'error', code: 'not_found', message: 'file removed', path },
                },
              };
            });
          } else {
            read(path);
            if (get().blame[path]) send({ type: 'blame', path, id: nextId() });
          }
        }
        for (const p of touched) if (p !== path && watched.has(p)) read(p);
        for (const dir of ['', ...expanded])
          if (touched.some((t) => parentOf(t) === dir)) list(dir);
        return;
      }
      case 'matches':
        set({ matches: msg.entries });
        return;
      case 'blameHunks':
        set((s) => ({
          blame: {
            ...s.blame,
            [msg.path]: { hunks: msg.hunks, ...(msg.repoUrl ? { repoUrl: msg.repoUrl } : {}) },
          },
        }));
        return;
      case 'textMatches':
        // Only the newest query's answer counts; older replies can arrive late.
        if (msg.q === textQuery) set({ textHits: msg.hits });
        return;
      case 'error': {
        if (msg.path) {
          pendingReads.delete(msg.path);
          set((s) => {
            const loading = new Set(s.loading);
            loading.delete(msg.path!);
            return { errors: { ...s.errors, [msg.path!]: msg }, loading };
          });
        }
        return;
      }
    }
  };

  /** Expands every loaded folder and lists the ones not loaded yet, until the cap. */
  const continueExpandAll = () => {
    const { tree, config } = get();
    const cap = config.maxEntries ?? Infinity;
    const loadedEntries = Object.values(tree).flat();
    if (loadedEntries.length >= cap) {
      expandingAll = false;
      set({ expandAllCapped: true });
      return;
    }
    const dirs = loadedEntries.filter((e) => e.kind === 'dir').map((e) => e.path);
    const missing = dirs.filter((d) => !tree[d]);
    // A source may answer synchronously and re-enter this function, so merge rather than overwrite.
    set((s) => ({ expanded: new Set([...s.expanded, ...dirs]) }));
    if (missing.length === 0) expandingAll = false;
    for (const d of missing) list(d);
  };

  return {
    ...initial(),

    attach(src) {
      source = src;
      useAssets.getState().attach((m) => src.send(m));
      const offMsg = src.onMessage(onMessage);
      const offStatus = src.onStatus((status) => {
        setConnection(status);
        set({ status });
      });
      return () => {
        offMsg();
        offStatus();
        stopPreferenceSync?.();
        stopPreferenceSync = null;
        if (source === src) source = null;
      };
    },

    setHeadings(headings, frontmatter) {
      set({ headings, frontmatter });
    },

    open(path) {
      const prev = get().path;
      if (prev !== null && prev !== path) send({ type: 'unsubscribe', path: prev });
      set({ path, ...(prev !== path ? { headings: [], frontmatter: undefined } : {}) });
      if (prev !== path) send({ type: 'subscribe', path });
      read(path);
    },

    refresh(path) {
      read(path);
    },

    watch(path) {
      watched.set(path, (watched.get(path) ?? 0) + 1);
      if (!get().files[path]) read(path);
      return () => {
        const n = (watched.get(path) ?? 1) - 1;
        if (n > 0) watched.set(path, n);
        else watched.delete(path);
      };
    },

    requestBlame(path) {
      send({ type: 'blame', path, id: nextId() });
    },

    reveal(path) {
      for (let dir = parentOf(path); dir !== ''; dir = parentOf(dir)) get().expand(dir);
    },

    expand(dir) {
      set((s) => ({ expanded: new Set(s.expanded).add(dir) }));
      if (!get().tree[dir]) list(dir);
    },

    collapse(dir) {
      set((s) => {
        const expanded = new Set(s.expanded);
        expanded.delete(dir);
        return { expanded };
      });
    },

    expandAll() {
      expandingAll = true;
      set({ expandAllCapped: false });
      continueExpandAll();
    },

    collapseAll() {
      expandingAll = false;
      set({ expanded: new Set(), expandAllCapped: false });
    },

    search(q) {
      if (q.length === 0) return set({ matches: [] });
      send({ type: 'search', q, id: nextId() });
    },

    searchText(q) {
      textQuery = q;
      if (q.length < 2) return set({ textHits: [] });
      send({ type: 'searchText', q, id: nextId() });
    },

    reset() {
      pendingReads.clear();
      expandingAll = false;
      stopPreferenceSync?.();
      stopPreferenceSync = null;
      source = null;
      set(initial());
    },
  };
});

export { isUnder as _isUnder };
