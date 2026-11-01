import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { scripted } from './helpers/scripted.js';

vi.mock('../src/viewers/live/libs.js', () => ({
  loadThreeLibs: vi.fn(async () => ({ three: 'window.THREE = {};' })),
}));

const ID = 'brisk-otter-lantern';
const BASE = `/s/${ID}`;
const SHARE: ShareInfo = {
  id: ID,
  host: { id: 'h', name: 'Rob', color: '#3e63dd' },
  mode: 'read-only',
  webUrl: `https://relay.test/s/${ID}`,
  appUrl: `leaf://join/${ID}`,
};
const nb = (html: string, md = '') =>
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { language: 'python', name: 'python3' } },
    cells: [
      { cell_type: 'markdown', metadata: {}, source: md },
      {
        cell_type: 'code',
        execution_count: 1,
        metadata: {},
        source: '1',
        outputs: [
          {
            output_type: 'execute_result',
            execution_count: 1,
            metadata: {},
            data: { 'text/html': [html] },
          },
        ],
      },
    ],
  });
const DOC = (body: string) => `# Doc\n\n${body}\n`;
const LIVE = DOC('```canvas\nonFrame(() => {});\n```');
const fence = (j: string) => '```ipynb\n' + j + '\n```';
const H = '<table><tr><td>6</td></tr></table>';
const NOTEBOOK = DOC(fence(nb(H)));

beforeEach(() => {
  useDocuments.getState().reset();
});

async function open(doc: string, share?: ShareInfo, name = 'README.md') {
  history.replaceState(null, '', share ? `${BASE}/` : '/');
  const s = scripted(
    { [name]: doc },
    {
      ...(share ? { share } : {}),
      capabilities: { watch: true, write: false, collaborate: false },
    },
  );
  render(<Reader source={s.source} base={share ? BASE : ''} />);
  await screen.findByRole('heading', { name: 'Doc', level: 1 });
}
const frames = () => document.querySelectorAll('iframe');
const run = () => screen.findByRole('button', { name: 'Run' });

describe('code in a shared document', () => {
  it('own_documents_run_as_before', async () => {
    await open(LIVE);
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    expect(document.querySelector('.leaf-run-gate')).toBeNull();
  });

  it('shared_code_waits_for_run', async () => {
    await open(LIVE, SHARE);
    const btn = await run();
    expect(frames().length).toBe(0);
    expect(document.querySelector('.leaf-run-gate')!.textContent).toContain(
      'Code from Rob’s share runs only when you ask',
    );
    fireEvent.click(btn);
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    expect(document.querySelector('.leaf-run-gate')).toBeNull();
  });

  it('notebook_html_outputs_wait_too', async () => {
    await open(NOTEBOOK, SHARE);
    const btn = await run();
    expect(frames().length).toBe(0);
    fireEvent.click(btn);
    expect(await screen.findByTitle('Output')).toBeTruthy();
    expect(frames().length).toBe(1);
  });

  it('two_notebooks_in_one_document_are_approved_separately', async () => {
    await open(DOC(fence(nb(H, 'first')) + '\n\n' + fence(nb(H, 'second'))), SHARE, 'two.md');
    const [first] = await screen.findAllByRole('button', { name: 'Run' });
    fireEvent.click(first!);
    expect(await screen.findByTitle('Output')).toBeTruthy();
    expect(frames().length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'Run' }).length).toBe(1);
  });

  it('changed_notebook_html_asks_again', async () => {
    await open(NOTEBOOK, SHARE, 'edit.md');
    fireEvent.click(await run());
    expect(await screen.findByTitle('Output')).toBeTruthy();
    cleanup();
    await open(DOC(fence(nb('<b>new</b>'))), SHARE, 'edit.md');
    await run();
    expect(frames().length).toBe(0);
  });
});

describe('a gated pane and its start timer', () => {
  afterEach(() => vi.useRealTimers());

  it('does_not_time_out_while_waiting_and_times_out_after_run', async () => {
    await open(LIVE, SHARE, 'timer.md');
    const btn = await run();
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(13_000);
    });
    expect(screen.queryByText(/didn.t start/)).toBeNull();
    fireEvent.click(btn);
    await act(async () => {
      vi.advanceTimersByTime(13_000);
    });
    expect(screen.queryByText(/didn.t start/)).not.toBeNull();
  });

  it('re_gated_pane_still_does_not_time_out', async () => {
    await open(LIVE, SHARE, 'regate.md');
    fireEvent.click(await run());
    cleanup();
    await open(DOC('```canvas\nonFrame(() => { /* changed */ });\n```'), SHARE, 'regate.md');
    await run();
    vi.useFakeTimers();
    await act(async () => {
      vi.advanceTimersByTime(13_000);
    });
    expect(screen.queryByText(/didn.t start/)).toBeNull();
  });
});
