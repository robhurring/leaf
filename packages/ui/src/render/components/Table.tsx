// Markdown tables. One marked with <!--table:filter--> gets a filter bar that hides
// the rows whose text doesn't match; cells keep their markdown (bold, code, links).
import { useEffect, useRef, useState, type ComponentProps } from 'react';

type Props = ComponentProps<'table'> & { 'data-filter'?: string };

function FilterTable(props: ComponentProps<'table'>) {
  const ref = useRef<HTMLTableElement>(null);
  const [q, setQ] = useState('');
  const [count, setCount] = useState<{ shown: number; all: number } | null>(null);
  useEffect(() => {
    const rows = [
      ...(ref.current?.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr') ?? []),
    ];
    const needle = q.trim().toLowerCase();
    let shown = 0;
    for (const tr of rows) {
      tr.hidden = needle !== '' && !(tr.textContent ?? '').toLowerCase().includes(needle);
      if (!tr.hidden) shown++;
    }
    setCount({ shown, all: rows.length });
  }, [q]);
  return (
    <div className="leaf-table-filter">
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
      <table ref={ref} {...props} />
    </div>
  );
}

export function Table({ 'data-filter': filter, ...props }: Props) {
  return filter ? <FilterTable {...props} /> : <table {...props} />;
}
