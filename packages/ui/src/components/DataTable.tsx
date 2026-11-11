// A sortable, filterable table with columns that drag wider or narrower, for the csv viewer.
// Cells may hold markdown links or bare URLs; they render as links.
import { useMemo, useRef, useState } from 'react';
import { Search } from '../icons/index.js';
import { cellParts, cellText, compareCells } from '../render/cells.js';
import { useColumnResize } from '../render/columnResize.js';

export type DataTableProps = { header: string[]; rows: string[][]; caption?: string };
type Sort = { col: number; dir: 'asc' | 'desc' } | null;

function Cell({ value }: { value: string }) {
  const parts = cellParts(value);
  if (parts.length === 1 && !parts[0].href) return <>{value}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noreferrer">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function DataTable({ header, rows, caption }: DataTableProps) {
  const [sort, setSort] = useState<Sort>(null);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLTableElement>(null);
  useColumnResize(ref, header);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle
      ? rows.filter((r) => r.some((c) => cellText(c).toLowerCase().includes(needle)))
      : rows;
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort(
        (a, b) => compareCells(a[col] ?? '', b[col] ?? '') * (dir === 'asc' ? 1 : -1),
      );
    }
    return out;
  }, [rows, q, sort]);

  const cycle = (col: number) =>
    setSort((s) =>
      s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null,
    );

  return (
    <div className="leaf-datatable">
      <div className="leaf-datatable-bar">
        <label className="leaf-filter">
          <Search size={13} />
          <input
            type="search"
            aria-label="Filter rows"
            placeholder="Filter rows"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <span className="leaf-datatable-count">
          {visible.length === rows.length
            ? `${rows.length} rows`
            : `${visible.length} of ${rows.length} rows`}
        </span>
      </div>
      <div className="leaf-table-scroll">
        <table ref={ref}>
          {caption && <caption>{caption}</caption>}
          <thead>
            <tr>
              {header.map((h, i) => (
                <th
                  key={i}
                  role="columnheader"
                  aria-sort={
                    sort?.col === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  onClick={() => cycle(i)}
                  className="leaf-sortable"
                >
                  {h}
                  <span className="leaf-sort-mark" aria-hidden="true">
                    {sort?.col === i ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, ri) => (
              <tr key={ri}>
                {header.map((_, ci) => (
                  <td key={ci}>
                    <Cell value={r[ci] ?? ''} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
