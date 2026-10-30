// What a map shows: GeoJSON, TopoJSON, or rows with latitude and longitude (a CSV,
// a JSON array, JSON Lines logs), all turned into GeoJSON features.
import { parse } from 'yaml';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { latLonKeys, parseRows } from '../../data/rows.js';

export const MAX_FEATURES = 20000;

export type MapSpec = { from?: string; lat?: string; lon?: string; color?: string };
export type Format = 'geojson' | 'topojson' | 'rows' | 'json';
type Topo = { feature(t: Topology, o: unknown): Feature | FeatureCollection };

/** A fence's spec: GeoJSON or TopoJSON fences hold the data; a map fence is YAML. */
export function parseSpec(
  lang: string,
  code: string,
): { spec: MapSpec; inline?: Format } | { error: string } {
  if (lang === 'geojson' || lang === 'topojson') return { spec: {}, inline: lang };
  let raw: unknown;
  try {
    raw = parse(code);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const spec = (raw ?? {}) as MapSpec;
  if (typeof spec.from !== 'string')
    return { error: 'A map block needs from: a GeoJSON, TopoJSON, CSV, or JSON Lines file.' };
  return { spec };
}

export function formatOf(path: string): Format {
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'geojson') return 'geojson';
  if (ext === 'topojson') return 'topojson';
  if (ext === 'json') return 'json';
  return 'rows';
}

const asFeatures = (g: unknown): Feature[] => {
  const o = g as { type?: string; features?: Feature[] };
  if (o?.type === 'FeatureCollection') return o.features ?? [];
  if (o?.type === 'Feature') return [o as Feature];
  if (o && typeof o.type === 'string')
    return [{ type: 'Feature', properties: {}, geometry: o as Geometry }];
  throw new Error('Not GeoJSON: expected a FeatureCollection, a Feature, or a geometry.');
};

export function toFeatures(
  text: string,
  format: Format,
  path: string,
  spec: MapSpec,
  topo: Topo,
): { features: Feature[]; total: number } | { error: string } {
  try {
    let all: Feature[];
    let kind = format;
    let parsed: unknown;
    if (kind !== 'rows') {
      parsed = JSON.parse(text);
      if (kind === 'json') {
        const t = (parsed as { type?: string })?.type;
        kind = Array.isArray(parsed) ? 'rows' : t === 'Topology' ? 'topojson' : 'geojson';
      }
    }
    if (kind === 'geojson') all = asFeatures(parsed);
    else if (kind === 'topojson') {
      const t = parsed as Topology;
      all = Object.values(t.objects ?? {}).flatMap((o) => asFeatures(topo.feature(t, o)));
    } else {
      const rows = Array.isArray(parsed)
        ? (parsed as Record<string, unknown>[])
        : parseRows(text, path);
      const found = rows[0] ? latLonKeys(rows[0] as never) : null;
      const lat = spec.lat ?? found?.lat;
      const lon = spec.lon ?? found?.lon;
      if (!lat || !lon) {
        const cols = Object.keys(rows[0] ?? {}).join(', ');
        throw new Error(
          `No latitude and longitude columns in ${path} (it has ${cols}). Name them with lat: and lon:.`,
        );
      }
      all = rows.flatMap((r) => {
        const y = Number(r[lat]);
        const x = Number(r[lon]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
        return [
          {
            type: 'Feature',
            properties: r,
            geometry: { type: 'Point', coordinates: [x, y] },
          } as Feature,
        ];
      });
    }
    return { features: all.slice(0, MAX_FEATURES), total: all.length };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
