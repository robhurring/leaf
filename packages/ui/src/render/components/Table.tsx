// Markdown tables. One marked with <!--table:filter--> gets a filter bar that hides the rows whose
// text doesn't match; <!--table:sort--> makes the column headers sort the rows; both may be given.
// Cells keep their markdown (bold, code, links): the rows are reordered and hidden in place.
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { compareCells } from '../cells.js';

type Props = ComponentProps<'table'> & { 'data-filter'?: string; 'data-sort'?: string };
type Sort = { col: number; dir: 'asc' | 'desc' } | null;

function InteractiveTable({
  filter,
  sort: sortable,
  ...props
}: ComponentProps<'table'> & { filter: boolean; sort: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  // Each row's place in the markdown, noted when the row is first seen, so clearing the sort
  // restores that order and a row a live edit adds is filtered and sorted with the rest.
  const order = useRef({ of: new WeakMap<HTMLTableRowElement, number>(), next: 0 });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  const [count, setCount] = useState<{ shown: number; all: number } | null>(null);
  const { children } = props;

  const rows = () => {
    const { of } = order.current;
    const all = [
      ...(ref.current?.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr') ?? []),
    ];
    for (const tr of all) if (!of.has(tr)) of.set(tr, order.current.next++);
    return all.sort((a, b) => of.get(a)! - of.get(b)!);
  };

  useEffect(() => {
    const all = rows();
    const needle = q.trim().toLowerCase();
    let shown = 0;
    for (const tr of all) {
      tr.hidden = needle !== '' && !(tr.textContent ?? '').toLowerCase().includes(needle);
      if (!tr.hidden) shown++;
    }
    setCount({ shown, all: all.length });
  }, [q, children]);

  useEffect(() => {
    if (!sortable) return;
    const all = rows();
    const body = all[0]?.parentElement;
    if (!body) return;
    const cell = (tr: HTMLTableRowElement, col: number) => tr.children[col]?.textContent ?? '';
    const by = sort && (sort.dir === 'asc' ? 1 : -1);
    const ordered =
      sort && by
        ? [...all].sort((a, b) => compareCells(cell(a, sort.col), cell(b, sort.col)) * by)
        : all;
    for (const tr of ordered) body.appendChild(tr);
  }, [sort, sortable, children]);

  useEffect(() => {
    if (!sortable) return;
    const heads = [
      ...(ref.current?.querySelectorAll<HTMLTableCellElement>(':scope > thead th') ?? []),
    ];
    const offs = heads.map((th, i) => {
      th.classList.add('leaf-sortable');
      th.setAttribute('role', 'columnheader');
      th.setAttribute(
        'aria-sort',
        sort?.col === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      );
      let mark = th.querySelector<HTMLSpanElement>(':scope > .leaf-sort-mark');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'leaf-sort-mark';
        mark.setAttribute('aria-hidden', 'true');
        th.appendChild(mark);
      }
      mark.textContent = sort?.col === i ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      const onClick = () =>
        setSort((s) =>
          s?.col !== i ? { col: i, dir: 'asc' } : s.dir === 'asc' ? { col: i, dir: 'desc' } : null,
        );
      th.addEventListener('click', onClick);
      return () => th.removeEventListener('click', onClick);
    });
    return () => offs.forEach((off) => off());
  }, [sort, sortable, children]);

  return (
    <div className="leaf-table-filter">
      {filter && (
        <div className="leaf-datatable-bar">
          <label className="leaf-filter">
            <svg
              width={13}
              height={13}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              aria-label="Filter rows"
              placeholder="Filter rows"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          {count && (
            <span className="leaf-datatable-count">
              {count.shown === count.all
                ? `${count.all} rows`
                : `${count.shown} of ${count.all} rows`}
            </span>
          )}
        </div>
      )}
      <table ref={ref} {...props} />
    </div>
  );
}

export function Table({ 'data-filter': filter, 'data-sort': sort, ...props }: Props) {
  return filter || sort ? (
    <InteractiveTable filter={!!filter} sort={!!sort} {...props} />
  ) : (
    <table {...props} />
  );
}
