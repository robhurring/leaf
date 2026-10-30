// A chart block's YAML, turned into a Chart.js config: rows from a data file become
// labels and datasets, and datasets without colors get leaf's.
import { parse } from 'yaml';
import { parseRows, type Row } from '../../data/rows.js';
import { paletteAt } from '../palette.js';

const TYPES = ['bar', 'line', 'pie', 'doughnut', 'radar', 'polarArea', 'scatter', 'bubble'];
const PER_POINT = ['pie', 'doughnut', 'polarArea'];

type Dataset = Record<string, unknown> & { data?: unknown[] };
export type ChartConfig = {
  type: string;
  data: { labels?: unknown[]; datasets: Dataset[] };
  options: Record<string, unknown>;
};
export type FromSpec = { from: string; x?: string; y?: string | string[] };
export type Spec = { raw: Record<string, unknown>; from?: FromSpec };

export function parseSpec(code: string): { spec: Spec } | { error: string } {
  let raw: unknown;
  try {
    raw = parse(code);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { error: 'A chart is a YAML (or JSON) object: type, data, and options.' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !TYPES.includes(obj.type))
    return { error: `A chart needs a type: ${TYPES.join(', ')}.` };
  const data = obj.data as Record<string, unknown> | undefined;
  const from =
    data && typeof data.from === 'string'
      ? { from: data.from, x: data.x as string | undefined, y: data.y as string | string[] }
      : undefined;
  return { spec: { raw: obj, from } };
}

/** Datasets from rows: `x` labels the points, each `y` column is a dataset. */
function fromRows(rows: Row[], spec: FromSpec, path: string) {
  const columns = Object.keys(rows[0] ?? {});
  const x = spec.x ?? columns[0];
  const ys = spec.y === undefined ? columns.filter((c) => c !== x) : [spec.y].flat();
  for (const c of [x, ...ys])
    if (c === undefined || !columns.includes(c))
      throw new Error(`No column "${c}" in ${path} (it has ${columns.join(', ')}).`);
  return {
    labels: rows.map((r) => r[x!]),
    datasets: ys.map((y) => ({ label: y, data: rows.map((r) => r[y]) })),
  };
}

export function buildConfig(
  spec: Spec,
  file?: { path: string; text?: string; error?: string },
): { config: ChartConfig } | { error: string } | { waiting: true } {
  const raw = spec.raw;
  let data = (raw.data ?? { datasets: [] }) as ChartConfig['data'];
  if (spec.from) {
    if (!file || file.error) return file?.error ? { error: file.error } : { waiting: true };
    if (file.text === undefined) return { waiting: true };
    try {
      data = fromRows(parseRows(file.text, file.path), spec.from, file.path);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  const type = raw.type as string;
  const datasets = (data.datasets ?? []).map((d, i) => {
    if (d.backgroundColor || d.borderColor) return d;
    if (PER_POINT.includes(type))
      return { ...d, backgroundColor: (d.data ?? []).map((_, j) => paletteAt(j)) };
    const color = paletteAt(i);
    return type === 'line' || type === 'radar'
      ? { ...d, borderColor: color, backgroundColor: color + '33' }
      : { ...d, backgroundColor: color, borderColor: color };
  });
  return {
    config: {
      type,
      data: { ...data, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...((raw.options as Record<string, unknown>) ?? {}),
      },
    },
  };
}
