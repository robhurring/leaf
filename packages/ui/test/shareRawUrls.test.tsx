// In a browser share, a large file's own `url` is the host's leaf-raw://, which the
// viewer's browser can't load: whole-file URLs come from the welcome's rawBase.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { useDocuments } from '../src/store/documents.js';
import { image } from '../src/viewers/image/index.js';
import { media } from '../src/viewers/media/index.js';
import { BinaryCard } from '../src/viewers/binary/index.js';

const RAW = 'https://relay.test/s/x-y-z/raw/';
const large = (path: string, kind: FileMessage['kind'], mime: string): FileMessage => ({
  type: 'file',
  path,
  kind,
  mime,
  encoding: 'none',
  url: `leaf-raw://localhost/${path}`,
  size: 9_000_000,
  mtime: 7,
});

beforeEach(() => useDocuments.getState().reset());

describe('whole-file URLs in a share', () => {
  it('an image loads from the relay', () => {
    useDocuments.setState({
      capabilities: { watch: true, write: false, collaborate: false, rawUrls: true, rawBase: RAW },
    });
    const file = large('pics/big shot.png', 'image', 'image/png');
    const { container } = render(<image.Rich file={file} docPath={file.path} config={{}} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(
      `${RAW}pics/big%20shot.png?t=7`,
    );
  });

  it('a video loads from the relay', () => {
    useDocuments.setState({
      capabilities: { watch: true, write: false, collaborate: false, rawUrls: true, rawBase: RAW },
    });
    const file = large('clip.mp4', 'video', 'video/mp4');
    const { container } = render(<media.Rich file={file} docPath={file.path} config={{}} />);
    expect(container.querySelector('video')!.getAttribute('src')).toBe(`${RAW}clip.mp4?t=7`);
  });

  it('Download points at the relay', () => {
    useDocuments.setState({
      capabilities: { watch: true, write: false, collaborate: false, rawUrls: true, rawBase: RAW },
    });
    const file = large('dist/app.zip', 'binary', 'application/zip');
    render(<BinaryCard file={file} docPath={file.path} config={{}} />);
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      `${RAW}dist/app.zip`,
    );
  });

  it('without a rawBase, the file’s own url stands', () => {
    useDocuments.setState({
      capabilities: { watch: true, write: false, collaborate: false, rawUrls: true },
    });
    const file = { ...large('a.png', 'image', 'image/png'), url: '/raw/a.png' };
    const { container } = render(<image.Rich file={file} docPath={file.path} config={{}} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/raw/a.png?t=7');
    render(<BinaryCard file={file} docPath={file.path} config={{}} />);
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/raw/a.png');
  });
});
