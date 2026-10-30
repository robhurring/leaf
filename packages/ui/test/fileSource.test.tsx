import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { DocumentView } from '../src/components/DocumentView.js';
import { DocToolsContext } from '../src/components/Properties.js';

const sketch: FileMessage = {
  type: 'file',
  path: 'orbits.sketch',
  kind: 'text',
  lang: 'javascript',
  mime: 'text/javascript',
  encoding: 'utf8',
  content: 'onFrame(() => ctx.fillRect(0, 0, 1, 1));',
  url: '',
  size: 40,
  mtime: 1,
};

describe('a whole file made from text', () => {
  it('flips to its source from the file toolbar, and back', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    render(
      <DocToolsContext.Provider value={slot}>
        <DocumentView
          file={sketch}
          path="orbits.sketch"
          config={{}}
          numbering={false}
          linkBase=""
          onNavigate={() => {}}
        />
      </DocToolsContext.Provider>,
    );
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
    const toggle = slot.querySelector<HTMLButtonElement>('[aria-label="Show source"]')!;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByTitle('canvas animation')).toBeNull();
    expect(document.querySelector('.leaf-block-source')!.textContent).toContain('ctx.fillRect');
    fireEvent.click(toggle);
    expect(await screen.findByTitle('canvas animation')).toBeTruthy();
  });
});
