// CSV / TSV as a sortable, filterable table, for files and fenced blocks alike.
import { useMemo } from 'react';
import { DataTable } from '../../components/DataTable.js';
import { BinaryCard } from '../binary/index.js';
import type { Viewer, ViewerProps } from '../types.js';
import { parseDelimited } from './parse.js';

function CsvViewer(props: ViewerProps) {
  const { file, content } = props;
  const table = useMemo(() => (content === undefined ? null : parseDelimited(content)), [content]);
  if (!table) return <BinaryCard {...props} />;
  return <DataTable header={table.header} rows={table.rows} />;
}

export const csv: Viewer = {
  id: 'csv',
  matches: {
    ext: ['.csv', '.tsv'],
    lang: ['csv', 'tsv'],
    mime: ['text/csv', 'text/tab-separated-values'],
  },
  Inline: CsvViewer,
  Rich: CsvViewer,
  source: true,
};
