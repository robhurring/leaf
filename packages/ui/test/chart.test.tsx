import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

type Config = { type: string; data: { labels?: unknown[]; datasets: Record<string, unknown>[] } };
const charts = vi.hoisted(() => ({
  made: [] as { config: Config; updates: number; destroyed: boolean }[],
}));
vi.mock('chart.js/auto', () => ({
  default: class {
    config: Config;
    options: unknown;
    // As in Chart.js, data lives on the config.
    get data() {
      return this.config.data;
    }
    set data(d: Config['data']) {
      this.config.data = d;
    }
    updates = 0;
    destroyed = false;
    static defaults = { color: '', borderColor: '', font: { family: '' } };
    constructor(_canvas: unknown, config: Config) {
      this.config = config;
      this.options = (config as { options?: unknown }).options;
      charts.made.push(this);
    }
    update() {
      this.updates++;
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

const { viewers } = await import('../src/viewers/index.js');
const { registries } = await import('../src/render/registries/index.js');
const { useDocuments } = await import('../src/store/documents.js');
const { scripted } = await import('./helpers/scripted.js');

const ctx = { docPath: 'notes/report.md', config: {} };
const block = (code: string, meta = '') =>
  registries.blocks.resolve('chart')!.render(code, meta, ctx) as ReactElement;

const BAR = `type: bar
data:
  labels: [Jan, Feb]
  datasets:
    - label: Revenue
      data: [3, 5]
`;

beforeEach(() => {
  charts.made.length = 0;
  useDocuments.getState().reset();
});

describe('chart blocks', () => {
  it('chart fences and .chart files are charts', () => {
    expect(viewers.forLang('chart')?.id).toBe('chart');
    const file = {
      type: 'file' as const,
      path: 'sales.chart',
      kind: 'text',
      lang: 'yaml',
      mime: 'text/plain',
      encoding: 'utf8' as const,
      url: '',
      size: 1,
      mtime: 1,
    };
    expect(viewers.forFile(file).id).toBe('chart');
  });

  it('hands the YAML config to Chart.js, with leaf colors for datasets that have none', async () => {
    render(block(BAR));
    await waitFor(() => expect(charts.made).toHaveLength(1));
    const c = charts.made[0]!.config;
    expect(c.type).toBe('bar');
    expect(c.data.labels).toEqual(['Jan', 'Feb']);
    expect(c.data.datasets[0]!.data).toEqual([3, 5]);
    expect(c.data.datasets[0]!.backgroundColor).toBeTruthy();
  });

  it('is sized by the fence', async () => {
    render(block(BAR, 'height=400'));
    await waitFor(() => expect(charts.made).toHaveLength(1));
    expect((document.querySelector('.leaf-chart') as HTMLElement).style.height).toBe('400px');
  });

  it('a changed block updates the chart in place instead of making another', async () => {
    const { rerender } = render(block(BAR));
    await waitFor(() => expect(charts.made).toHaveLength(1));
    rerender(block(BAR.replace('[3, 5]', '[4, 6]')));
    await waitFor(() => expect(charts.made[0]!.updates).toBeGreaterThan(0));
    expect(charts.made).toHaveLength(1);
    expect(charts.made[0]!.config.data.datasets[0]!.data).toEqual([4, 6]);
  });

  it('reads its rows from a data file next to the document', async () => {
    const s = scripted({
      'notes/report.md': '#',
      'notes/sales.csv': 'month,revenue,cost\nJan,3,1\nFeb,5,2\n',
    });
    useDocuments.getState().attach(s.source);
    render(block('type: line\ndata:\n  from: ./sales.csv\n  x: month\n  y: [revenue, cost]\n'));
    await waitFor(() => expect(charts.made).toHaveLength(1));
    const c = charts.made[0]!.config;
    expect(c.data.labels).toEqual(['Jan', 'Feb']);
    expect(c.data.datasets.map((d) => [d.label, d.data])).toEqual([
      ['revenue', [3, 5]],
      ['cost', [1, 2]],
    ]);
  });

  it('says what is wrong instead of drawing nothing', async () => {
    render(block('type: bar\ndata: [nope'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    const s = scripted({ 'notes/report.md': '#', 'notes/sales.csv': 'month,revenue\nJan,3\n' });
    useDocuments.getState().attach(s.source);
    render(block('type: bar\ndata:\n  from: ./sales.csv\n  x: month\n  y: [profit]\n'));
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((a) => /profit/.test(a.textContent!))).toBe(true),
    );
  });

  it('a missing type says so', async () => {
    render(block('data:\n  datasets: []\n'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/type/);
  });

  it('goes away cleanly', async () => {
    const { unmount } = render(block(BAR));
    await waitFor(() => expect(charts.made).toHaveLength(1));
    act(() => unmount());
    expect(charts.made[0]!.destroyed).toBe(true);
  });
});
