import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../src/components/ErrorBoundary.js';
import { Markdown } from '../src/components/Markdown.js';

function Boom(): never {
  throw new Error('kaboom');
}

describe('error handling', () => {
  it('a throwing viewer shows an error state instead of unmounting the app', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary label="viewer">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/kaboom/);
    quiet.mockRestore();
  });

  it('a failing render shows the error in place', async () => {
    const throwing = () => () => {
      throw new Error('plugin exploded');
    };
    render(
      <Markdown
        source="# hi"
        registries={{
          parsers: {
            use: () => () => {},
            all: (stage) =>
              stage === 'remark' ? [{ plugin: throwing as never, stage: 'remark' }] : [],
          },
        }}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/plugin exploded/);
  });
});
