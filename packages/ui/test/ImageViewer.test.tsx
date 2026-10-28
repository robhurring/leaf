import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
