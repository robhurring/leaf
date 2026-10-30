// Rows from a data file a document points at: CSV or TSV, a JSON array of objects,
// or JSON Lines. Charts plot them; maps place them.
import { parseDelimited } from '../viewers/csv/parse.js';

export type Value = string | number | boolean | null;
export type Row = Record<string, Value>;

const NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const cell = (v: string): Value => (NUMBER.test(v.trim()) ? Number(v) : v);

export function parseRows(text: string, path: string): Row[] {
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv') {
    const table = parseDelimited(text, ext === 'tsv' ? '\t' : undefined);
    return table.rows.map((r) =>
      Object.fromEntries(table.header.map((h, i) => [h, cell(r[i] ?? '')])),
    );
  }
  if (ext === 'json') {
    const data: unknown = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error(`${path} should be a JSON array of objects`);
    return data as Row[];
  }
  if (ext === 'jsonl' || ext === 'ndjson') {
    return text.split('\n').flatMap((line, i) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as Row];
      } catch {
        throw new Error(`${path}, line ${i + 1}: not JSON`);
      }
    });
  }
  throw new Error(`${path}: leaf reads CSV, TSV, JSON, or JSON Lines here`);
}

const LAT = ['lat', 'latitude'];
const LON = ['lon', 'lng', 'long', 'longitude'];

/** The latitude and longitude columns of a row, by their usual names. */
export function latLonKeys(row: Row): { lat: string; lon: string } | null {
  const keys = Object.keys(row);
  const find = (names: string[]) => keys.find((k) => names.includes(k.toLowerCase()));
  const lat = find(LAT);
  const lon = find(LON);
  return lat && lon ? { lat, lon } : null;
}
