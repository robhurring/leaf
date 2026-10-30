import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { contentSize } from '../src/stage/measure.js';
import type { FileMessage } from '@leaf/protocol';
import { image } from '../src/viewers/image/index.js';

const file: FileMessage = {
  type: 'file',
  path: 'assets/photo.jpg',
  kind: 'image',
  mime: 'image/jpeg',
  encoding: 'none',
  url: '/raw/assets/photo.jpg',
  size: 2048,
  mtime: 1700000000000,
};

describe('image viewer', () => {
  it('shows only the image on its stage; facts belong to the Properties panel', () => {
    const { container } = render(<image.Rich file={file} docPath="assets/photo.jpg" config={{}} />);
    expect(container.querySelector('.leaf-image-stage img.leaf-image')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(container.textContent).not.toContain('2.0 KB');
  });

  // The Stage centers the picture at 1:1 once it has a size; measured before the file
  // loads, it saw the alt text's tiny box and put the picture's corner in the middle.
  it('has no size for the Stage until the picture has loaded', () => {
    const { container } = render(<image.Rich file={file} docPath="assets/photo.jpg" config={{}} />);
    const layer = container.firstElementChild!.parentElement!;
    Object.defineProperty(container.querySelector('.leaf-image-view')!, 'scrollWidth', {
      value: 80,
    });
    Object.defineProperty(container.querySelector('.leaf-image-view')!, 'scrollHeight', {
      value: 18,
    });
    expect(contentSize(layer)).toBeNull();
    fireEvent.load(container.querySelector('img.leaf-image')!);
    expect(contentSize(layer)).toEqual({ w: 80, h: 18 });
  });
});
