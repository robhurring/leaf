import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { useFileUrl } from '../src/viewers/fileUrl.js';

const file: FileMessage = {
  type: 'file',
  path: 'a.png',
  kind: 'image',
  mime: 'image/png',
  encoding: 'base64',
  content: 'iVBORw0KGgo=',
  url: '/raw/a.png',
  size: 8,
  mtime: 1,
};

function Probe() {
  const url = useFileUrl(file);
  return url ? <img src={url} alt="" /> : null;
}

describe('useFileUrl', () => {
  it('never hands out an object URL it has already revoked (strict mode remounts)', async () => {
    const revoked = new Set<string>();
    const real = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => void revoked.add(u);
    try {
      const { container } = render(
        <StrictMode>
          <Probe />
        </StrictMode>,
      );
      await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
      const src = container.querySelector('img')!.getAttribute('src')!;
      expect(src.startsWith('blob:')).toBe(true);
      expect(revoked.has(src)).toBe(false);
    } finally {
      URL.revokeObjectURL = real;
    }
  });
});
