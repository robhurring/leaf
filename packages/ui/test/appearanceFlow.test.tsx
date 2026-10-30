import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ render: vi.fn(), initialize: vi.fn() }));
vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize, render: mocks.render } }));

const { Reader } = await import('../src/components/Reader.js');
const { useDocuments } = await import('../src/store/documents.js');
const { useUi } = await import('../src/store/ui.js');
const { scripted } = await import('./helpers/scripted.js');

const DOC = '# Doc\n\n```mermaid\ngraph TD; A-->B\n```\n';

beforeEach(() => {
  history.replaceState(null, '', '/');
  useDocuments.getState().reset();
  useUi.getState().setAppearance('light');
  mocks.initialize.mockReset();
  mocks.render.mockReset().mockResolvedValue({ svg: '<svg data-diagram="ok"></svg>' });
});

describe('appearance reaches viewers live', () => {
  it('a mermaid fence re-renders dark when the menu switches to Dark', async () => {
    render(<Reader source={scripted({ 'README.md': DOC }).source} />);
    await waitFor(() => expect(document.querySelector('svg[data-diagram="ok"]')).toBeTruthy());
    expect(mocks.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'default' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    await waitFor(() =>
      expect(mocks.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({ themeVariables: expect.objectContaining({ darkMode: true }) }),
      ),
    );
  });
});
