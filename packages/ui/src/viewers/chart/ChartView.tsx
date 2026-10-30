// Charts: ```chart blocks and .chart files, a Chart.js config written as YAML. Data
// can sit in the block or come from a CSV, JSON, or JSON Lines file next to the
// document, and the chart redraws in place when either changes.
import { useEffect, useMemo, useRef } from 'react';
import type { ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { useAppearance } from '../appearance.js';
import { paneHeight } from '../live/frame.js';
import { INK } from '../palette.js';
import { useDataFile } from '../../data/useDataFile.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { buildConfig, parseSpec, type ChartConfig } from './config.js';

type ChartInstance = {
  config: { type: string };
  data: unknown;
  options: unknown;
  update(): void;
  destroy(): void;
};
type ChartClass = {
  new (canvas: HTMLCanvasElement, config: ChartConfig): ChartInstance;
  defaults: { color: string; borderColor: string; font: { family: string } };
};

let chartJs: Promise<ChartClass> | null = null;
const loadChartJs = () => {
  if (!chartJs) {
    chartJs = track(load(() => import('chart.js/auto'))).then((m) => m.default as never);
    chartJs.catch(() => (chartJs = null));
  }
  return chartJs;
};

export default function ChartView(props: ViewerProps & { fill?: boolean }) {
  const code = props.content ?? '';
  const dark = useAppearance(props.appearance) === 'dark';
  const parsed = useMemo(() => parseSpec(code), [code]);
  const spec = 'spec' in parsed ? parsed.spec : undefined;
  const file = useDataFile(props.docPath, spec?.from?.from);
  const built = useMemo(
    () => (spec ? buildConfig(spec, spec.from ? file : undefined) : parsed),
    [spec, parsed, file],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  const chart = useRef<ChartInstance | null>(null);

  // What the chart last drew, so a redraw that changes nothing leaves it (and its
  // animation) alone: a folder opening elsewhere re-renders this view too.
  const applied = useRef('');
  useEffect(() => {
    if (!('config' in built)) return;
    const key = `${dark}:${JSON.stringify(built.config)}`;
    if (key === applied.current && chart.current) return;
    let live = true;
    void loadChartJs().then((Chart) => {
      if (!live || !canvas.current) return;
      const ink = INK[dark ? 'dark' : 'light'];
      Chart.defaults.color = ink.muted;
      Chart.defaults.borderColor = ink.rule;
      Chart.defaults.font.family = 'system-ui, -apple-system, sans-serif';
      // Legend entries as small solid swatches, not outlined boxes.
      const labels = (Chart.defaults as { plugins?: { legend?: { labels?: object } } }).plugins
        ?.legend?.labels;
      if (labels)
        Object.assign(labels, { usePointStyle: true, pointStyle: 'rectRounded', boxHeight: 8 });
      applied.current = key;
      const c = chart.current;
      if (c && c.config.type === built.config.type) {
        // Same kind of chart: change it in place, so it animates to the new data.
        c.data = built.config.data;
        c.options = built.config.options;
        c.update();
      } else {
        c?.destroy();
        chart.current = new Chart(canvas.current, built.config);
      }
    });
    return () => {
      live = false;
    };
  }, [built, dark]);

  useEffect(
    () => () => {
      chart.current?.destroy();
      chart.current = null;
    },
    [],
  );

  const height = props.fill ? undefined : paneHeight(props.meta);
  return (
    <div className="leaf-chart-block">
      <div
        className="leaf-chart"
        data-fill={props.fill ? '' : undefined}
        style={height ? { height } : undefined}
      >
        <canvas ref={canvas} role="img" aria-label="Chart" />
      </div>
      {'error' in built && <DiagramError kind="chart" message={built.error} />}
    </div>
  );
}
