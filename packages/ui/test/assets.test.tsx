import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ClientMessage } from '@leaf/protocol';
import { Reader } from '../src/components/Reader.js';
import { useDocuments } from '../src/store/documents.js';
import { useAssets } from '../src/store/assets.js';
import { scripted } from './helpers/scripted.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useAssets.getState().reset();
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:fake-' + Math.random().toString(36).slice(2));
    URL.revokeObjectURL = vi.fn();
  }
});

describe('assets over the socket', () => {
  it('with raw URLs, images point at /raw and nothing is read over the socket', async () => {
    const { source, sent } = scripted(
      { 'doc.md': '# Pic\n\n![a](./a.png)\n', 'a.png': '' },
      { capabilities: { watch: true, write: false, collaborate: false, rawUrls: true } },
    );
    history.replaceState(null, '', '/doc.md');
    const { container } = render(<Reader source={source} />);
    await waitFor(() => expect(container.querySelector('img.leaf-image')).toBeTruthy());
    expect(container.querySelector('img.leaf-image')!.getAttribute('src')).toBe('/raw/a.png');
    expect(sent.filter((m: ClientMessage) => m.type === 'read' && m.path === 'a.png')).toEqual([]);
  });

  it('without raw URLs, the image is read over the socket and shown from its bytes', async () => {
    const { source, sent } = scripted(
      { 'doc.md': '# Pic\n\n![a](./a.png)\n', 'a.png': { base64: PNG, mime: 'image/png' } },
      { capabilities: { watch: true, write: false, collaborate: false } },
    );
    history.replaceState(null, '', '/doc.md');
    const { container } = render(<Reader source={source} />);
    await waitFor(() =>
      expect(container.querySelector('img.leaf-image')?.getAttribute('src')).toMatch(/^blob:/),
    );
    expect(sent.filter((m: ClientMessage) => m.type === 'read' && m.path === 'a.png')).toHaveLength(
      1,
    );
  });
});
