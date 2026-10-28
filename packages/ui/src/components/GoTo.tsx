// ⌘K: the title bar's search field. One query finds headings in the open document,
// files in the folder, and text in the document; results drop down beneath the field.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry, TextHit } from '@leaf/protocol';
import { File as FileIcon, Search } from '../icons/index.js';
import { findMatches } from '../find.js';
import type { Heading } from '../render/headings.js';
import { formatNumber } from '../render/number.js';

export type GoToMode = 'all' | 'files';

type TextMatch = { index: number; before: string; match: string; after: string };

type Item =
  | { kind: 'heading'; heading: Heading }
  | { kind: 'file'; entry: Entry }
  | { kind: 'text'; text: TextMatch }
  | { kind: 'hit'; hit: TextHit };

type Props = {
  mode: GoToMode;
  headings: Heading[];
  files: Entry[];
  numbering: boolean;
  /** The rendered document, for text matches. */
  docRoot(): Element | null;
  onSearch(q: string): void;
  /** Text matches across the folder, for the latest onSearchText query. */
  hits: TextHit[];
  /** The open document, left out of the other-files results. */
  currentPath: string | null;
  onSearchText(q: string): void;
  /** Opens `path` and finds `q` in it. */
  onOpenAt(path: string, q: string): void;
  onJump(slug: string): void;
  onOpen(path: string): void;
  /** Opens find in the document at match `index`. */
  onFind(q: string, index: number): void;
  onClose(): void;
};

const LIMIT = 8;
const TEXT_LIMIT = 6;

/** Every character of `q` appears in order in `text`. */
export function fuzzy(q: string, text: string): boolean {
  const needle = q.toLowerCase();
  const hay = text.toLowerCase();
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

/** The match with some text either side, taken from its whole block (paragraph, item, cell). */
function snippet(r: Range, index: number): TextMatch {
  const node = r.startContainer;
  const block =
    node.parentElement?.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, pre, blockquote, dd, dt') ??
    node.parentElement;
  let text = node.nodeValue ?? '';
  let start = r.startOffset;
  if (block) {
    const lead = document.createRange();
    lead.setStart(block, 0);
    lead.setEnd(node, r.startOffset);
    start = lead.toString().length;
    text = block.textContent ?? text;
  }
  const end = start + r.toString().length;
  const from = Math.max(0, start - 32);
  return {
    index,
    before: (from > 0 ? '…' : '') + text.slice(from, start).trimStart(),
    match: text.slice(start, end),
    after: text.slice(end, end + 60),
  };
}

/** `text` with the first occurrence of `q` marked. */
function Marked({ text, q }: { text: string; q: string }) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || !q) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

export function GoTo(p: Props) {
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const filesOnly = p.mode === 'files';
  const { onSearch, onSearchText } = p;

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (!p.files.length && !filesOnly) return;
    const t = setTimeout(() => onSearch(q.trim()), 120);
    return () => clearTimeout(t);
  }, [q, onSearch, filesOnly, p.files.length]);

  const needle = q.trim();
  // Text across the folder waits a little longer: it reads files.
  useEffect(() => {
    if (filesOnly || !p.files.length) return;
    const t = setTimeout(() => onSearchText(needle), 180);
    return () => clearTimeout(t);
  }, [needle, onSearchText, filesOnly, p.files.length]);
  useEffect(() => () => onSearchText(''), [onSearchText]);
  const headings = useMemo(
    () =>
      filesOnly
        ? []
        : p.headings.filter((h) => !needle || fuzzy(needle, h.text)).slice(0, needle ? LIMIT : 50),
    [filesOnly, p.headings, needle],
  );
  const files = useMemo(
    () =>
      needle || filesOnly
        ? p.files.filter((e) => !needle || fuzzy(needle, e.path)).slice(0, filesOnly ? 50 : LIMIT)
        : [],
    [filesOnly, p.files, needle],
  );
  const [text, textTotal] = useMemo<[TextMatch[], number]>(() => {
    const root = p.docRoot();
    if (filesOnly || needle.length < 2 || !root) return [[], 0];
    const ranges = findMatches(root, needle);
    return [ranges.slice(0, TEXT_LIMIT).map((r, i) => snippet(r, i)), ranges.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesOnly, needle]);

  const others =
    filesOnly || needle.length < 2
      ? []
      : p.hits.filter((h) => h.path !== p.currentPath).slice(0, LIMIT);

  const groups: { label: string; extra?: string; items: Item[] }[] = [
    {
      label: 'Headings',
      items: headings.map((heading) => ({ kind: 'heading' as const, heading })),
    },
    { label: 'Files', items: files.map((entry) => ({ kind: 'file' as const, entry })) },
    {
      label: 'In this document',
      extra: textTotal > text.length ? `${textTotal} matches` : undefined,
      items: text.map((t) => ({ kind: 'text' as const, text: t })),
    },
    { label: 'In other files', items: others.map((hit) => ({ kind: 'hit' as const, hit })) },
  ].filter((g) => g.items.length > 0);
  const items = groups.flatMap((g) => g.items);

  useEffect(() => setIndex(0), [q]);
  // Keep the selected row visible as ctrl-n/ctrl-p or the arrows move it.
  useEffect(() => {
    document
      .querySelector('#leaf-goto-list [aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    p.onClose();
    if (item.kind === 'heading') p.onJump(item.heading.slug);
    else if (item.kind === 'file') p.onOpen(item.entry.path);
    else if (item.kind === 'hit') p.onOpenAt(item.hit.path, needle);
    else p.onFind(needle, item.text.index);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey && !e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || (ctrl && k === 'n')) {
      e.preventDefault();
      setIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || (ctrl && k === 'p')) {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[index]);
    }
  };

  let n = -1;
  const option = (item: Item) => {
    const i = ++n;
    const key =
      item.kind === 'heading'
        ? `h:${item.heading.slug}`
        : item.kind === 'file'
          ? `f:${item.entry.path}`
          : item.kind === 'hit'
            ? `x:${item.hit.path}:${item.hit.line}`
            : `t:${item.text.index}`;
    return (
      <li
        key={key}
        id={`leaf-goto-${i}`}
        role="option"
        aria-selected={i === index}
        className={`leaf-goto-item ${i === index ? 'leaf-goto-active' : ''}`}
        onMouseEnter={() => setIndex(i)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(item)}
      >
        {item.kind === 'heading' ? (
          <>
            <span className="leaf-goto-depth">
              {p.numbering && item.heading.number
                ? formatNumber(item.heading.number)
                : 'H' + item.heading.depth}
            </span>
            <span className="leaf-goto-text">{item.heading.text}</span>
          </>
        ) : item.kind === 'file' ? (
          <>
            <FileIcon size={14} />
            <span className="leaf-goto-text">{item.entry.path}</span>
          </>
        ) : item.kind === 'hit' ? (
          <>
            <FileIcon size={14} />
            <span className="leaf-goto-hit">
              <span className="leaf-goto-path">
                {item.hit.path}
                <span>:{item.hit.line}</span>
              </span>
              <span className="leaf-goto-text leaf-goto-snippet">
                <Marked text={item.hit.text} q={needle} />
              </span>
            </span>
          </>
        ) : (
          <span className="leaf-goto-text leaf-goto-snippet">
            {item.text.before}
            <mark>{item.text.match}</mark>
            {item.text.after}
          </span>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="leaf-goto-scrim" onMouseDown={p.onClose} />
      <div className="leaf-goto">
        <label className="leaf-goto-field">
          <Search size={14} />
          <input
            ref={input}
            role="combobox"
            aria-label="Go to"
            aria-expanded="true"
            aria-controls="leaf-goto-list"
            aria-autocomplete="list"
            aria-activedescendant={items.length ? `leaf-goto-${index}` : undefined}
            placeholder={filesOnly ? 'Go to file' : 'Go to heading, file, or text'}
            value={q}
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </label>
        <ul id="leaf-goto-list" role="listbox" aria-label="Results" className="leaf-goto-list">
          {items.length === 0 && (
            <li role="presentation" className="leaf-empty">
              {needle ? 'Nothing matches' : 'Type to search'}
            </li>
          )}
          {groups.map((g) => (
            <li key={g.label} role="presentation">
              <div className="leaf-goto-group" aria-hidden="true">
                {g.label}
                {g.extra && <span>{g.extra}</span>}
              </div>
              <ul role="group" aria-label={g.label}>
                {g.items.map(option)}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
