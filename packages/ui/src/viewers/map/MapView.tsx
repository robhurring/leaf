// Maps: .geojson and .topojson files, ```geojson and ```topojson fences, and ```map
// blocks that plot a file's rows (a CSV, JSON Lines logs) by latitude and longitude.
// Drawn as SVG over a bundled outline of the world: no tiles, no network.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { usePinch } from '../../stage/usePinch.js';
import type { Feature } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { useAppearance } from '../appearance.js';
import { paneHeight } from '../live/frame.js';
import { INK, paletteAt } from '../palette.js';
import { useDataFile } from '../../data/useDataFile.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { MAX_FEATURES, formatOf, parseSpec, toFeatures } from './data.js';

type Libs = {
  geo: typeof import('d3-geo');
  topo: typeof import('topojson-client');
  world: Feature[];
};

let libs: Promise<Libs> | null = null;
const loadLibs = () => {
  if (!libs) {
    libs = track(
      load(async () => {
        const [geo, topo, atlas] = await Promise.all([
          import('d3-geo'),
          import('topojson-client'),
          import('world-atlas/countries-110m.json'),
        ]);
        const world = atlas.default as unknown as Topology;
        const land = topo.feature(world, world.objects.countries!) as unknown as {
          features: Feature[];
        };
        return { geo, topo, world: land.features };
      }),
    );
    libs.catch(() => (libs = null));
  }
  return libs;
};

const W = 960;

const describe = (p: Record<string, unknown> | null) =>
  Object.entries(p ?? {})
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');

export default function MapView(props: ViewerProps & { fill?: boolean }) {
  const lang = props.file.path.split('#').pop() ?? '';
  const ext = props.file.path.toLowerCase().endsWith('.topojson')
    ? 'topojson'
    : props.file.path.toLowerCase().endsWith('.geojson')
      ? 'geojson'
      : lang;
  const code = props.content ?? '';
  const dark = useAppearance(props.appearance) === 'dark';
  const ink = INK[dark ? 'dark' : 'light'];
  const parsed = useMemo(() => parseSpec(ext, code), [ext, code]);
  const spec = 'spec' in parsed ? parsed : undefined;
  const file = useDataFile(props.docPath, spec?.spec.from);
  const [lib, setLib] = useState<Libs | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  // The map's own zoom: a pinch closes in around the fingers, a drag pans once zoomed,
  // a double click goes back. Points and lines keep their size on screen.
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const heightRef = useRef(0);

  useEffect(() => {
    let live = true;
    loadLibs().then(
      (l) => live && setLib(l),
      (e: unknown) => live && setLibError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const data = useMemo(() => {
    if (!lib || !spec) return null;
    if (spec.inline)
      return toFeatures(code, spec.inline, props.docPath, spec.spec, lib.topo as never);
    if (file.error) return { error: file.error };
    if (file.text === undefined) return null;
    return toFeatures(file.text, formatOf(file.path), file.path, spec.spec, lib.topo as never);
  }, [lib, spec, code, file, props.docPath]);

  const height = props.fill ? 560 : /height=/.test(props.meta ?? '') ? paneHeight(props.meta) : 420;
  heightRef.current = height;
  const error =
    'error' in parsed ? parsed.error : (libError ?? (data && 'error' in data ? data.error : null));

  const drawn = useMemo(() => {
    if (!lib || !data || 'error' in data) return null;
    const { geo } = lib;
    const collection = { type: 'FeatureCollection' as const, features: data.features };
    const [[w, s], [e, n]] = data.features.length
      ? geo.geoBounds(collection)
      : [
          [-180, -60],
          [180, 80],
        ];
    const span = Math.max(e - w < 0 ? e - w + 360 : e - w, n - s);
    // Much of the world: an equal-area view of all of it. Otherwise, close in around the data.
    const projection =
      span > 120 || !data.features.length
        ? geo.geoEqualEarth().fitExtent(
            [
              [12, 12],
              [W - 12, height - 12],
            ],
            { type: 'Sphere' },
          )
        : geo.geoMercator().fitExtent(
            [
              [24, 24],
              [W - 24, height - 24],
            ],
            (() => {
              const pad = Math.max(1, span * 0.25);
              const [x0, y0, x1, y1] = [
                w - pad,
                Math.max(-85, s - pad),
                e + pad,
                Math.min(85, n + pad),
              ];
              return {
                type: 'Polygon',
                coordinates: [
                  [
                    [x0, y0],
                    [x1, y0],
                    [x1, y1],
                    [x0, y1],
                    [x0, y0],
                  ],
                ],
              } as never;
            })(),
          );
    const path = geo.geoPath(projection);
    const key = spec?.spec.color;
    const categories = new Map<string, number>();
    if (key)
      for (const f of data.features) {
        const v = String(f.properties?.[key] ?? '—');
        categories.set(v, (categories.get(v) ?? 0) + 1);
      }
    const order = [...categories.keys()];
    const colorOf = (f: Feature) =>
      key ? paletteAt(order.indexOf(String(f.properties?.[key] ?? '—'))) : paletteAt(0);
    return { projection, path, categories, colorOf };
  }, [lib, data, height, spec]);

  const pinch = useCallback((p: { x: number; y: number }, factor: number) => {
    const r = svg.current?.getBoundingClientRect();
    const s = r && r.width ? W / r.width : 1;
    const px = p.x * s;
    const py = p.y * s;
    setView((v) => {
      const k = Math.min(40, Math.max(1, v.k * factor));
      const ratio = k / v.k;
      const h = heightRef.current;
      return {
        k,
        x: Math.min(0, Math.max(W - W * k, px - (px - v.x) * ratio)),
        y: Math.min(0, Math.max(h - h * k, py - (py - v.y) * ratio)),
      };
    });
  }, []);
  usePinch(svg, pinch, !!drawn);
  const scaleToView = () => {
    const r = svg.current?.getBoundingClientRect();
    return r && r.width ? W / r.width : 1;
  };
  const clampView = (k: number, x: number, y: number) => ({
    k,
    x: Math.min(0, Math.max(W - W * k, x)),
    y: Math.min(0, Math.max(heightRef.current - heightRef.current * k, y)),
  });
  const onPointerDown = (e: PointerEvent) => {
    if (view.k <= 1 || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: e.clientX, y: e.clientY };
    const s = scaleToView();
    setView((v) => clampView(v.k, v.x + (e.clientX - from.x) * s, v.y + (e.clientY - from.y) * s));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="leaf-map-block">
      {drawn && data && !('error' in data) && (
        <div className="leaf-diagram leaf-map" data-fill={props.fill ? '' : undefined}>
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${height}`}
            role="img"
            aria-label="Map"
            data-zoomed={view.k > 1 ? '' : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => setView({ k: 1, x: 0, y: 0 })}
          >
            <g
              className="leaf-map-view"
              transform={`translate(${view.x},${view.y}) scale(${view.k})`}
            >
              <g
                className="leaf-map-land"
                fill={ink.land}
                stroke={dark ? '#0d1117' : '#ffffff'}
                strokeWidth={0.5}
              >
                {lib!.world.map((c, i) => (
                  <path key={i} d={drawn.path(c) ?? undefined} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
              <g>
                {data.features.map((f, i) => {
                  const color = drawn.colorOf(f);
                  if (f.geometry?.type === 'Point') {
                    const [x, y] = drawn.projection(f.geometry.coordinates as [number, number]) ?? [
                      -99, -99,
                    ];
                    return (
                      <circle
                        key={i}
                        className="leaf-map-feature"
                        cx={x}
                        cy={y}
                        r={(data.features.length > 500 ? 3 : 5) / view.k}
                        fill={color}
                        stroke={dark ? '#0d1117' : '#ffffff'}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      >
                        <title>{describe(f.properties)}</title>
                      </circle>
                    );
                  }
                  const line = /LineString/.test(f.geometry?.type ?? '');
                  return (
                    <path
                      key={i}
                      className="leaf-map-feature"
                      d={drawn.path(f) ?? undefined}
                      fill={line ? 'none' : color}
                      fillOpacity={line ? undefined : 0.35}
                      stroke={color}
                      strokeWidth={line ? 2 : 1.2}
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{describe(f.properties)}</title>
                    </path>
                  );
                })}
              </g>
            </g>
          </svg>
          {drawn.categories.size > 0 && (
            <ul className="leaf-map-legend" aria-label="Legend">
              {[...drawn.categories].map(([name, n], i) => (
                <li key={name}>
                  <span className="leaf-map-swatch" style={{ background: paletteAt(i) }} />
                  {name} <span className="leaf-map-count">{n}</span>
                </li>
              ))}
            </ul>
          )}
          {data.total > MAX_FEATURES && (
            <p className="leaf-map-note">
              Showing the first {MAX_FEATURES.toLocaleString('en-US')} of{' '}
              {data.total.toLocaleString('en-US')}.
            </p>
          )}
        </div>
      )}
      {!drawn && !error && <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />}
      {error && <DiagramError kind="map" message={error} />}
    </div>
  );
}
