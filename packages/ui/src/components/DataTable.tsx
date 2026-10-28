// A sortable, filterable table. Used by the csv viewer now and by interactive
// markdown tables later.
import { useMemo, useState } from 'react';
import { Search } from '../icons/index.js';

export type DataTableProps = { header: string[]; rows: string[][]; caption?: string };
type Sort = { col: number; dir: 'asc' | 'desc' } | null;

const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

export function compareCells(a: string, b: string): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function DataTable({ header, rows, caption }: DataTableProps) {
  const [sort, setSort] = useState<Sort>(null);
  const [q, setQ] = useState('');

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => r.some((c) => c.toLowerCase().includes(needle))) : rows;
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
      <table>
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
                <td key={ci}>{r[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
