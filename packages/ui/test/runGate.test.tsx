import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ShareInfo } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { contentHash } from '../src/viewers/hash.js';
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
  return s;
}
/** The host saves `doc` over the open file: the mounted reader hears it and reads again. */
function save(s: ReturnType<typeof scripted>, name: string, doc: string) {
  s.files[name] = doc;
  act(() => s.emit({ type: 'changed', path: name, change: 'modified' }));
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

describe('approval follows the block’s content while the document stays open', () => {
  it('a live pane whose code the host changes asks again', async () => {
    const s = await open(LIVE, SHARE, 'live-edit.md');
    fireEvent.click(await run());
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    save(s, 'live-edit.md', DOC('```canvas\nonFrame(() => { /* swapped */ });\n```'));
    await run();
    expect(frames().length).toBe(0);
    // The code approved before still runs when it comes back.
    save(s, 'live-edit.md', LIVE);
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    expect(document.querySelector('.leaf-run-gate')).toBeNull();
  });

  it('a notebook HTML output the host changes asks again', async () => {
    const s = await open(NOTEBOOK, SHARE, 'nb-edit.md');
    fireEvent.click(await run());
    expect(await screen.findByTitle('Output')).toBeTruthy();
    save(s, 'nb-edit.md', DOC(fence(nb('<b>swapped</b>'))));
    await run();
    expect(frames().length).toBe(0);
  });

  it('a share allowed for the session still runs changed code', async () => {
    const share = { ...SHARE, id: 'allow-live', webUrl: 'https://relay.test/s/allow-live' };
    const s = await open(NOTEBOOK, share, 'allow-live.md');
    fireEvent.click(await screen.findByRole('button', { name: 'Allow for this session' }));
    expect(await screen.findByTitle('Output')).toBeTruthy();
    save(s, 'allow-live.md', DOC(fence(nb('<b>swapped again</b>'))));
    await screen.findByTitle('Output');
    await waitFor(() =>
      expect(frames()[0]!.getAttribute('srcdoc')).toContain('<b>swapped again</b>'),
    );
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });
});

describe('approval is for the exact code, not its short hash', () => {
  // Pairs a host can find in seconds: the 32-bit content hash is the same for both.
  const CODE_A = 'onFrame(() => {}); // 479599';
  const CODE_B = 'onFrame(() => {}); // 662382';
  const HTML_A = '<b>66109</b>';
  const HTML_B = '<b>111106</b>';

  it('a live pane whose new code hashes like the approved code still asks', async () => {
    expect(contentHash(CODE_B)).toBe(contentHash(CODE_A));
    const canvas = (code: string) => DOC('```canvas\n' + code + '\n```');
    await open(canvas(CODE_A), SHARE, 'collide.md');
    fireEvent.click(await run());
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    cleanup();
    await open(canvas(CODE_B), SHARE, 'collide.md');
    await run();
    expect(frames().length).toBe(0);
  });

  it('a notebook output that hashes like the approved one, in a notebook that does too, still asks', async () => {
    const a = nb(HTML_A, 'n31667');
    const b = nb(HTML_B, 'n31698');
    expect(contentHash(HTML_B)).toBe(contentHash(HTML_A));
    expect(contentHash(b)).toBe(contentHash(a));
    await open(DOC(fence(a)), SHARE, 'collide-nb.md');
    fireEvent.click(await run());
    expect(await screen.findByTitle('Output')).toBeTruthy();
    cleanup();
    await open(DOC(fence(b)), SHARE, 'collide-nb.md');
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

describe('allowing a share for this session', () => {
  const shareNamed = (id: string): ShareInfo => ({
    ...SHARE,
    id,
    webUrl: `https://relay.test/s/${id}`,
  });
  const allow = () => screen.findByRole('button', { name: 'Allow for this session' });

  it('runs every gated block in the document at once', async () => {
    const two = DOC(fence(nb(H, 'first')) + '\n\n' + fence(nb(H, 'second')));
    await open(two, shareNamed('allow-one'), 'allow-one.md');
    expect((await screen.findAllByRole('button', { name: 'Run' })).length).toBe(2);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Allow for this session' }))[0]!);
    expect((await screen.findAllByTitle('Output')).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('runs the blocks of other documents in the same share without asking', async () => {
    const share = shareNamed('allow-two');
    await open(NOTEBOOK, share, 'allow-two.md');
    fireEvent.click(await allow());
    expect(await screen.findByTitle('Output')).toBeTruthy();
    cleanup();
    await open(LIVE, share, 'allow-two.md');
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    expect(document.querySelector('.leaf-run-gate')).toBeNull();
  });

  it('another share still asks', async () => {
    await open(NOTEBOOK, shareNamed('allow-three'), 'allow-three.md');
    fireEvent.click(await allow());
    expect(await screen.findByTitle('Output')).toBeTruthy();
    cleanup();
    await open(NOTEBOOK, shareNamed('allow-other'), 'allow-three.md');
    await run();
    expect(frames().length).toBe(0);
  });
});
