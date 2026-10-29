// The file header above the document: the path, the file's facts (size, modified,
// last commit, frontmatter count), the full property table on demand, expanding down
// inside the header, and a slot where the viewer puts its controls.
import { createContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { shortenPath } from './shortenPath.js';
import type { FileMessage, GitInfo } from '@leaf/protocol';
import { Chevron, FilePlus, PencilLine, Sliders } from '../icons/index.js';
import { formatBytes, formatDate, formatWhen } from '../viewers/binary/format.js';
import { useUi } from '../store/ui.js';

type Props = {
  file: FileMessage;
  frontmatter?: Record<string, unknown>;
  /** Receives the element viewers render their controls into. */
  toolsRef?: (el: HTMLElement | null) => void;
};

/** Where a viewer showing a whole file puts its controls; null inside blocks and the Stage. */
export const DocToolsContext = createContext<HTMLElement | null>(null);

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);
/** Keys whose plain-text value is a list, as people write it: `tags: a, b`. */
const LIST_KEYS = new Set(['tags', 'tag', 'keywords', 'categories', 'category', 'aliases']);

/** A frontmatter value, with comma lists under list-like keys split into items. */
function shaped(key: string, value: unknown): unknown {
  if (typeof value === 'string' && LIST_KEYS.has(key.toLowerCase()))
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  return value;
}

/** Frontmatter values get a shape: lists as pills, booleans as yes/no, urls as links. */
export function PropertyValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined || value === '')
    return <span className="leaf-prop-empty">—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="leaf-prop-empty">—</span>;
    return (
      <ul className="leaf-pills">
        {value.map((v, i) => (
          <li key={i} className="leaf-pill">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'boolean')
    return <span className={`leaf-badge leaf-badge-${value}`}>{value ? 'Yes' : 'No'}</span>;
  if (value instanceof Date) return formatDate(value.getTime());
  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
  const text = String(value);
  if (isUrl(text))
    return (
      <a href={text} target="_blank" rel="noreferrer">
        {text}
      </a>
    );
  return text;
}

function CommitValue({ git }: { git: GitInfo }) {
  const short = git.commit.slice(0, 7);
  const pr = /\(#(\d+)\)\s*$/.exec(git.message);
  const message = pr ? git.message.slice(0, pr.index).trim() : git.message;
  return (
    <span className="leaf-commit">
      {git.repoUrl ? (
        <a
          className="leaf-commit-sha"
          href={`${git.repoUrl}/commit/${git.commit}`}
          target="_blank"
          rel="noreferrer"
        >
          {short}
        </a>
      ) : (
        <code className="leaf-commit-sha">{short}</code>
      )}{' '}
      {message}
      {pr && (
        <>
          {' '}
          {git.repoUrl ? (
            <a
              className="leaf-pill"
              href={`${git.repoUrl}/pull/${pr[1]}`}
              target="_blank"
              rel="noreferrer"
            >
              #{pr[1]}
            </a>
          ) : (
            <span className="leaf-pill">#{pr[1]}</span>
          )}
        </>
      )}
    </span>
  );
}

/** A relative time that shows the exact one on hover. */
function When({ ms }: { ms: number }) {
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatDate(ms)}>
      {formatWhen(ms)}
    </time>
  );
}

type Row = [string, ReactNode];

/** The properties toggle: an icon and a dropdown arrow; the tooltip counts the frontmatter. */
function PropertiesToggle({
  open,
  count,
  onToggle,
}: {
  open: boolean;
  count: number;
  onToggle(): void;
}) {
  const label = count ? `Properties (${count})` : 'Properties';
  return (
    <button
      type="button"
      className="leaf-props-toggle"
      aria-label={label}
      aria-expanded={open}
      aria-controls="leaf-props-table"
      title={label}
      onClick={onToggle}
    >
      <Sliders size={14} />
      <Chevron size={11} className={`leaf-chev ${open ? 'leaf-chev-down' : ''}`} />
    </button>
  );
}

function Group({ label, rows }: { label: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <tbody aria-label={label}>
      <tr className="leaf-props-group">
        <th colSpan={2} scope="colgroup">
          {label}
        </th>
      </tr>
      {rows.map(([k, v]) => (
        <tr key={k}>
          <th scope="row">{k}</th>
          <td>{v}</td>
        </tr>
      ))}
    </tbody>
  );
}

/** Frontmatter first, then the file's own facts, in a panel that opens beneath the file line. */
function PropertiesPanel({ front, facts, git }: { front: Row[]; facts: Row[]; git: boolean }) {
  const showGit = useUi((s) => s.showGit);
  const setShowGit = useUi((s) => s.setShowGit);
  return (
    <div className="leaf-props-panel">
      <div className="leaf-props-scroll">
        <table id="leaf-props-table" className="leaf-props-table">
          <Group label="Frontmatter" rows={front} />
          <Group label="File" rows={facts} />
        </table>
      </div>
      {git && (
        <div className="leaf-props-bar" role="toolbar" aria-label="Properties options">
          <label className="leaf-props-option">
            <button
              type="button"
              role="switch"
              className="leaf-switch"
              aria-checked={showGit}
              aria-label="Show last commit"
              onClick={() => setShowGit(!showGit)}
            />
            <span>Show last commit</span>
          </label>
        </div>
      )}
    </div>
  );
}

export function Properties({ file, frontmatter, toolsRef }: Props) {
  const fm = Object.entries(frontmatter ?? {});
  const [open, setOpen] = useState(false);
  const showGit = useUi((s) => s.showGit);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const rows: Row[] = [
    ['Path', file.path],
    ['Size', formatBytes(file.size)],
    ['Type', file.mime],
    ['Modified', formatDate(file.mtime)],
  ];
  if (file.created !== undefined) rows.push(['Created', formatDate(file.created)]);
  if (file.git) {
    rows.push(['Commit', <CommitValue git={file.git} />]);
    rows.push(['Author', `${file.git.author}, ${formatDate(file.git.date)}`]);
  }
  const front: Row[] = fm.map(([k, v]) => [k, <PropertyValue value={shaped(k, v)} />]);

  return (
    <div className="leaf-dochead" role="region" aria-label="File">
      <div className="leaf-dochead-line leaf-dochead-main">
        <FitPath path={file.path} />
        <div className="leaf-dochead-dates">
          {file.created !== undefined && (
            <Stamp label="Created" ms={file.created} icon={<FilePlus size={13} />} />
          )}
          <Stamp label="Modified" ms={file.mtime} icon={<PencilLine size={13} />} />
        </div>
        <PropertiesToggle open={open} count={fm.length} onToggle={() => setOpen((o) => !o)} />
      </div>
      {file.git && showGit && (
        // The last commit as `git log` prints it: sha, subject, when, author.
        <div className="leaf-dochead-line leaf-dochead-git">
          <CommitValue git={file.git} />{' '}
          <span className="leaf-gitlog-when">
            (<When ms={file.git.date} />)
          </span>{' '}
          <span className="leaf-gitlog-author">&lt;{file.git.author}&gt;</span>
        </div>
      )}
      {open && <PropertiesPanel front={front} facts={rows} git={!!file.git} />}
      <div className="leaf-dochead-tools" role="toolbar" aria-label="File tools" ref={toolsRef} />
    </div>
  );
}

/** A file date: an icon and a relative time; what it is and the exact time on hover. */
function Stamp({ label, ms, icon }: { label: string; ms: number; icon: ReactNode }) {
  const text = `${label} ${formatDate(ms)}`;
  return (
    <span className="leaf-stamp" aria-label={text} title={text}>
      {icon}
      <time dateTime={new Date(ms).toISOString()}>{formatWhen(ms)}</time>
    </span>
  );
}

/** The file's path, folders shortened vim-style only as far as needed to fit its line. */
function FitPath({ path }: { path: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(path);
  useLayoutEffect(() => {
    const el = box.current;
    const ctx =
      typeof document !== 'undefined' ? document.createElement('canvas').getContext?.('2d') : null;
    if (!el || !ctx) return setShown(path);
    const fit = () => {
      const style = getComputedStyle(el);
      ctx.font = `600 ${style.fontSize} ${style.fontFamily}`;
      const room = el.clientWidth;
      setShown(room ? shortenPath(path, (t) => ctx.measureText(t).width <= room) : path);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [path]);
  const slash = shown.lastIndexOf('/');
  return (
    <div className="leaf-crumbs" aria-label="Path" title={path} ref={box}>
      {slash >= 0 && <span className="leaf-crumbs-dir">{shown.slice(0, slash + 1)}</span>}
      <span className="leaf-crumbs-name">{shown.slice(slash + 1)}</span>
    </div>
  );
}
