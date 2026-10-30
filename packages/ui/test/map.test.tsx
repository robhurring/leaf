import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { viewers } from '../src/viewers/index.js';
import { registries } from '../src/render/registries/index.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted } from './helpers/scripted.js';

const ctx = { docPath: 'notes/ops.md', config: {} };
const block = (lang: string, code: string, meta = '') =>
  registries.blocks.resolve(lang)!.render(code, meta, ctx) as ReactElement;
const features = () => document.querySelectorAll('.leaf-map-feature');

const GEO = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Office' },
      geometry: { type: 'Point', coordinates: [-74, 40.7] },
    },
    {
      type: 'Feature',
      properties: { name: 'Zone' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-75, 40],
            [-73, 40],
            [-73, 41],
            [-75, 41],
            [-75, 40],
          ],
        ],
      },
    },
  ],
});

beforeEach(() => useDocuments.getState().reset());

describe('maps', () => {
  it('GeoJSON and TopoJSON files and fences, and map blocks, are maps', () => {
    const file = (path: string): FileMessage => ({
      type: 'file',
      path,
      kind: 'text',
      lang: 'json',
      mime: 'application/json',
      encoding: 'utf8',
      url: '',
      size: 1,
      mtime: 1,
    });
    expect(viewers.forFile(file('a.geojson')).id).toBe('map');
    expect(viewers.forFile(file('a.topojson')).id).toBe('map');
    for (const lang of ['geojson', 'topojson', 'map'])
      expect(viewers.forLang(lang)?.id).toBe('map');
  });

  it('draws the features over the world, each with its properties on hover', async () => {
    render(block('geojson', GEO));
    await waitFor(() => expect(features()).toHaveLength(2));
    expect(document.querySelector('.leaf-map-land')).toBeTruthy();
    expect(document.querySelector('circle.leaf-map-feature title')!.textContent).toContain(
      'name: Office',
    );
    expect(document.querySelector('path.leaf-map-feature')).toBeTruthy();
  });

  it('a pinch zooms the map itself: points keep their size, the view closes in', async () => {
    render(block('geojson', GEO));
    await waitFor(() => expect(features()).toHaveLength(2));
    const svg = document.querySelector('.leaf-map svg') as SVGSVGElement;
    const layer = svg.querySelector('.leaf-map-view') as SVGGElement;
    const point = svg.querySelector('circle.leaf-map-feature') as SVGCircleElement;
    const r0 = Number(point.getAttribute('r'));
    const scroll = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true });
    act(() => {
      svg.dispatchEvent(scroll);
    });
    expect(scroll.defaultPrevented).toBe(false);
    const pinch = new WheelEvent('wheel', { deltaY: -60, bubbles: true, cancelable: true });
    Object.defineProperty(pinch, 'ctrlKey', { value: true });
    act(() => {
      svg.dispatchEvent(pinch);
    });
    expect(pinch.defaultPrevented).toBe(true);
    const k = Number(/scale\(([\d.]+)\)/.exec(layer.getAttribute('transform')!)![1]);
    expect(k).toBeGreaterThan(1);
    // Drawn at the same size on screen: the radius shrinks by the zoom.
    expect(Number(point.getAttribute('r'))).toBeCloseTo(r0 / k, 3);
    fireEvent.doubleClick(svg);
    expect(layer.getAttribute('transform')).toBe('translate(0,0) scale(1)');
  });

  it('reads TopoJSON', async () => {
    const topo = {
      type: 'Topology',
      objects: {
        places: {
          type: 'GeometryCollection',
          geometries: [{ type: 'Point', coordinates: [10, 50], properties: { name: 'A' } }],
        },
      },
      arcs: [],
    };
    render(block('topojson', JSON.stringify(topo)));
    await waitFor(() => expect(features()).toHaveLength(1));
  });

  it('plots rows from a log file by latitude and longitude, colored by a column', async () => {
    const s = scripted({
      'notes/ops.md': '#',
      'notes/logs.jsonl': [
        { lat: 40.7, lng: -74, status: 200, path: '/a' },
        { lat: 51.5, lng: -0.1, status: 500, path: '/b' },
        { lat: 35.7, lng: 139.7, status: 200, path: '/c' },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n'),
    });
    useDocuments.getState().attach(s.source);
    render(block('map', 'from: ./logs.jsonl\ncolor: status\n'));
    await waitFor(() => expect(features()).toHaveLength(3));
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend.textContent).toContain('200');
    expect(legend.textContent).toContain('500');
  });

  it('says what is wrong instead of drawing nothing', async () => {
    render(block('geojson', '{ nope'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    const s = scripted({ 'notes/ops.md': '#', 'notes/rows.csv': 'a,b\n1,2\n' });
    useDocuments.getState().attach(s.source);
    render(block('map', 'from: ./rows.csv\n'));
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((a) => /latitude/i.test(a.textContent!))).toBe(true),
    );
  });

  it('draws at most 20,000 points and says so', async () => {
    const rows = ['lat,lon'];
    for (let i = 0; i < 20001; i++) rows.push(`${(i % 160) - 80},${(i % 340) - 170}`);
    const s = scripted({ 'notes/ops.md': '#', 'notes/many.csv': rows.join('\n') });
    useDocuments.getState().attach(s.source);
    render(block('map', 'from: ./many.csv\n'));
    expect(await screen.findByText(/first 20,000 of 20,001/)).toBeTruthy();
    expect(features()).toHaveLength(20000);
    // Twenty thousand elements take happy-dom a few seconds when the suite runs in parallel.
  }, 20000);
});
