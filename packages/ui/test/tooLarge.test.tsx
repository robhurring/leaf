import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { image } from '../src/viewers/image/index.js';
import { media } from '../src/viewers/media/index.js';
import { markdown } from '../src/viewers/markdown/index.js';

const base = { type: 'file', mtime: 1700000000000, encoding: 'none' } as const;

describe('a file that cannot be shown says so', () => {
  it('text too big to send shows a notice with its size, not an empty page', () => {
    const file: FileMessage = {
      ...base,
      path: 'logs/big.md',
      kind: 'markdown',
      mime: 'text/markdown',
      url: '/raw/logs/big.md',
      size: 8_400_000,
    };
    render(<markdown.Rich file={file} docPath={file.path} config={{}} />);
    expect(screen.getByText('Too large to show here')).toBeTruthy();
    expect(screen.getByText('8.0 MB')).toBeTruthy();
  });

  it('an image that fails to load says so instead of an empty frame', () => {
    const file: FileMessage = {
      ...base,
      path: 'shot.png',
      kind: 'image',
      mime: 'image/png',
      url: 'leaf-raw://localhost/shot.png',
      size: 8_000_000,
    };
    const { container } = render(<image.Rich file={file} docPath={file.path} config={{}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.error(container.querySelector('img.leaf-image')!);
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load shot.png');
  });

  it('a video that fails to load says so too', () => {
    const file: FileMessage = {
      ...base,
      path: 'clip.mp4',
      kind: 'media',
      mime: 'video/mp4',
      url: 'leaf-raw://localhost/clip.mp4',
      size: 80_000_000,
    };
    const { container } = render(<media.Rich file={file} docPath={file.path} config={{}} />);
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByRole('alert').textContent).toContain('Couldn’t load clip.mp4');
  });
});
