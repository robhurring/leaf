import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Markdown } from '../src/components/Markdown.js';

// Blame and other overlays anchor to a document's top-level blocks by their source
// lines, so every block, framed ones included, has to carry data-pos.
describe('framed blocks keep their source position', () => {
  it('a highlighted code block and a diagram block carry data-pos on their frame', async () => {
    const md = '# T\n\n```js\nconst a = 1\n```\n\n```mermaid\ngraph LR\nA-->B\n```\n';
    render(<Markdown source={md} docPath="a.md" />);
    await waitFor(() => expect(document.querySelectorAll('article > .leaf-frame')).toHaveLength(2));
    const frames = [...document.querySelectorAll('article > .leaf-frame')];
    expect(frames.map((f) => f.getAttribute('data-pos'))).toEqual(['3:1-5:4', '7:1-10:4']);
  });
});
