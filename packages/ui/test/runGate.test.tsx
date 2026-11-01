import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
const NB = JSON.stringify({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { language: 'python', name: 'python3' } },
  cells: [
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
          data: { 'text/html': ['<table><tr><td>6</td></tr></table>'] },
        },
      ],
    },
  ],
});
const DOC = (body: string) => `# Doc\n\n${body}\n`;
const LIVE = DOC('```canvas\nonFrame(() => {});\n```');
const NOTEBOOK = DOC('```ipynb\n' + NB + '\n```');

beforeEach(() => {
  useDocuments.getState().reset();
});

async function open(doc: string, share?: ShareInfo) {
  history.replaceState(null, '', share ? `${BASE}/` : '/');
  const s = scripted(
    { 'README.md': doc },
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
});
