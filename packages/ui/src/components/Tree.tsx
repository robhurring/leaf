// The file sidebar: lazy folder tree, filter box, expand/collapse all.
import { useEffect, useMemo, useState } from 'react';
import type { Entry } from '@leaf/protocol';
import {
  Chevron,
  Code,
  CollapseAll,
  Diagram,
  ExpandAll,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Media,
  Search,
} from '../icons/index.js';
import { useDocuments } from '../store/documents.js';
import { IconButton } from './IconButton.js';
import type { Presence } from '../usePresence.js';

const ICON_BY_EXT: Record<string, typeof FileIcon> = {
  '.png': ImageIcon,
  '.jpg': ImageIcon,
  '.jpeg': ImageIcon,
  '.gif': ImageIcon,
  '.svg': ImageIcon,
  '.webp': ImageIcon,
  '.mmd': Diagram,
  '.puml': Diagram,
  '.excalidraw': Diagram,
  '.drawio': Diagram,
  '.mp4': Media,
  '.mp3': Media,
  '.webm': Media,
  '.wav': Media,
  '.pdf': Media,
  '.ts': Code,
  '.tsx': Code,
  '.js': Code,
  '.py': Code,
  '.rb': Code,
  '.go': Code,
  '.rs': Code,
  '.sh': Code,
  '.json': Code,
  '.yaml': Code,
  '.yml': Code,
  '.toml': Code,
  '.css': Code,
  '.html': Code,
};
const iconFor = (e: Entry) => {
  if (e.kind === 'dir') return Folder;
  const dot = e.name.lastIndexOf('.');
  return (dot > 0 && ICON_BY_EXT[e.name.slice(dot).toLowerCase()]) || FileIcon;
};

type Props = {
  onOpen(path: string): void;
  /** Open, or animating closed. */
  state?: Presence;
};

export function Tree({ onOpen, state = 'open' }: Props) {
  const tree = useDocuments((s) => s.tree);
  const expanded = useDocuments((s) => s.expanded);
  const current = useDocuments((s) => s.path);
  const matches = useDocuments((s) => s.matches);
  const capped = useDocuments((s) => s.expandAllCapped);
  const { expand, collapse, expandAll, collapseAll, search } = useDocuments.getState();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    if (q.trim().length < 2) {
      search('');
      return;
    }
    const t = setTimeout(() => search(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q, search]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const seen = new Map<string, Entry>();
    for (const e of Object.values(tree).flat())
      if (e.kind === 'file' && e.path.toLowerCase().includes(needle)) seen.set(e.path, e);
    for (const e of matches) if (e.kind === 'file') seen.set(e.path, e);
    return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [q, tree, matches]);

  const row = (e: Entry, depth: number) => {
    const Icon = iconFor(e);
    const isOpen = expanded.has(e.path);
    const active = e.path === current;
    return (
      <li
        key={e.path}
        role="treeitem"
        aria-expanded={e.kind === 'dir' ? isOpen : undefined}
        aria-selected={active}
      >
        <button
          type="button"
          className={`leaf-row ${active ? 'leaf-row-active' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() =>
            e.kind === 'dir' ? (isOpen ? collapse(e.path) : expand(e.path)) : onOpen(e.path)
          }
        >
          {e.kind === 'dir' ? (
            <Chevron size={12} className={`leaf-chev ${isOpen ? 'leaf-chev-open' : ''}`} />
          ) : (
            <span className="leaf-chev-space" />
          )}
          <Icon size={15} className="leaf-row-icon" />
          <span className="leaf-row-name">{e.name}</span>
        </button>
        {e.kind === 'dir' && isOpen && tree[e.path] && (
          <ul role="group">{tree[e.path]!.map((c) => row(c, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <nav
      className="leaf-tree"
      aria-label="Files"
      data-state={state ?? undefined}
      aria-hidden={state === 'closing' || undefined}
    >
      <div className="leaf-side-head">
        <h2>Files</h2>
        <IconButton label="Expand all" small onClick={expandAll}>
          <ExpandAll size={14} />
        </IconButton>
        <IconButton label="Collapse all" small onClick={collapseAll}>
          <CollapseAll size={14} />
        </IconButton>
      </div>
      <label className="leaf-filter">
        <Search size={13} />
        <input
          type="search"
          aria-label="Filter files"
          placeholder="Filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (!filtered || filtered.length === 0) return;
            const ctrl = e.ctrlKey && !e.metaKey;
            const k = e.key.toLowerCase();
            const move = (d: 1 | -1) => {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, Math.max(0, i + d)));
            };
            if (e.key === 'ArrowDown' || (ctrl && k === 'n')) move(1);
            else if (e.key === 'ArrowUp' || (ctrl && k === 'p')) move(-1);
            else if (e.key === 'Enter') {
              e.preventDefault();
              const hit = filtered[Math.min(active, filtered.length - 1)];
              if (hit) onOpen(hit.path);
            }
          }}
        />
      </label>
      {filtered ? (
        <ul className="leaf-tree-list leaf-tree-flat" role="listbox" aria-label="Matching files">
          {filtered.length === 0 && <li className="leaf-empty">No matches</li>}
          {filtered.map((e, i) => (
            <li
              key={e.path}
              role="option"
              aria-selected={e.path === current}
              data-active={i === active}
              ref={(el) => {
                if (el && i === active) el.scrollIntoView?.({ block: 'nearest' });
              }}
            >
              <button
                type="button"
                className={`leaf-row ${e.path === current ? 'leaf-row-active' : ''}`}
                onClick={() => onOpen(e.path)}
              >
                <FileIcon size={15} className="leaf-row-icon" />
                <span className="leaf-row-name">{e.path}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="leaf-tree-list" role="tree">
          {(tree[''] ?? []).map((e) => row(e, 0))}
          {capped && (
            <li className="leaf-empty">
              Stopped expanding: too many entries. Open folders one at a time.
            </li>
          )}
        </ul>
      )}
    </nav>
  );
}
