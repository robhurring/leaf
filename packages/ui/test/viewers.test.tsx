import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import type { ReactElement } from 'react';
import { viewers } from '../src/viewers/index.js';
import { registries } from '../src/render/registries/index.js';
import { binary } from '../src/viewers/binary/index.js';
import { code } from '../src/viewers/code/index.js';
import { media } from '../src/viewers/media/index.js';
import { formatBytes } from '../src/viewers/binary/format.js';
import { image } from '../src/viewers/image/index.js';
import { markdown } from '../src/viewers/markdown/index.js';

const f = (
  path: string,
  kind: string,
  mime?: string,
  extra: Partial<FileMessage> = {},
): FileMessage => ({
  type: 'file',
  path,
  kind,
  mime: mime ?? 'application/octet-stream',
  encoding: 'none',
  url: '/raw/' + path,
  size: 10,
  mtime: 1,
  ...extra,
});
const props = { docPath: 'x', config: {} };

describe('viewer registry', () => {
  it('forFile picks by ext, then mime, then kind, else binary', () => {
    expect(viewers.forFile(f('a.py', 'text')).id).toBe('code');
    expect(viewers.forFile(f('x.png', 'image')).id).toBe('image');
    expect(viewers.forFile(f('x.weird', 'binary')).id).toBe('binary');
    expect(viewers.forFile(f('x.mp4', 'media', 'video/mp4')).id).toBe('media');
    expect(viewers.forFile(f('x.pdf', 'pdf', 'application/pdf')).id).toBe('media');
    expect(viewers.forFile(f('README.md', 'markdown', 'text/markdown')).id).toBe('markdown');
    expect(viewers.forFile(f('Dockerfile', 'text')).id).toBe('code');
  });

  it('forLang resolves registered fence languages', () => {
    expect(viewers.forLang('nope')).toBeUndefined();
  });

  it('a fenced block hands its info string after the language to the viewer', () => {
    const el = registries.blocks
      .resolve('mermaid')!
      .render('graph TD', 'height=480', { docPath: 'a.md', config: {} }) as ReactElement<{
      props: { meta?: string };
    }>;
    expect(el.props.props.meta).toBe('height=480');
  });
});

describe('binary viewer', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1234567)).toBe('1.2 MB');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('card shows name, size, and a download link', () => {
    render(<binary.Rich file={f('blob.bin', 'binary', undefined, { size: 1234567 })} {...props} />);
    expect(screen.getByText('blob.bin')).toBeTruthy();
    expect(screen.getByText('1.2 MB')).toBeTruthy();
    expect(screen.getByRole('link', { name: /download/i }).getAttribute('href')).toBe(
      '/raw/blob.bin',
    );
  });
});

describe('code viewer', () => {
  it('rich mounts CodeMirror read-only with line numbers', async () => {
    const { container } = render(
      <code.Rich
        file={f('a.ts', 'text', 'text/plain', { lang: 'typescript', encoding: 'utf8' })}
        content={'const a = 1\nconst b = 2'}
        {...props}
      />,
    );
    // The file bar's controls are icon buttons with names.
    for (const name of ['Wrap lines', 'Copy']) {
      const b = screen.getByRole('button', { name });
      expect(b.querySelector('svg'), name).toBeTruthy();
      expect(b.textContent?.trim()).toBe('');
    }
    // CodeMirror loads on demand.
    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
    expect(container.querySelectorAll('.cm-gutterElement').length).toBeGreaterThan(1);
    expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false');
  });

  it('rich shows the binary card when content was not inlined', () => {
    render(
      <code.Rich file={f('huge.log', 'text', 'text/plain', { size: 5_000_000 })} {...props} />,
    );
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
  });
});

describe('image viewer', () => {
  it('shows svg through an img element, never inline markup', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { container } = render(
      <image.Rich file={f('logo.svg', 'image', 'image/svg+xml')} {...props} />,
    );
    expect(container.querySelector('img.leaf-image')?.getAttribute('src')).toContain(
      '/raw/logo.svg',
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('markdown viewer', () => {
  it('shows the file card when the content was not inlined', () => {
    render(
      <markdown.Rich
        file={f('huge.md', 'markdown', 'text/markdown', { size: 5_000_000 })}
        {...props}
      />,
    );
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
  });
});

describe('media viewer', () => {
  it('picks the element by mime', () => {
    // happy-dom reports that it will not load iframe pages; that is expected here.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      render(
        <media.Rich file={f('a.pdf', 'pdf', 'application/pdf')} {...props} />,
      ).container.querySelector('iframe'),
    ).toBeTruthy();
    quiet.mockRestore();
    expect(
      render(
        <media.Rich file={f('a.mp3', 'media', 'audio/mpeg')} {...props} />,
      ).container.querySelector('audio'),
    ).toBeTruthy();
    expect(
      render(
        <media.Rich file={f('a.mp4', 'media', 'video/mp4')} {...props} />,
      ).container.querySelector('video'),
    ).toBeTruthy();
  });
});
