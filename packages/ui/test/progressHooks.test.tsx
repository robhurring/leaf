import { it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ProgressBar } from '../src/components/ProgressBar.js';
import { useProgress } from '../src/render/progress.js';

it('the progress bar survives loads starting and finishing', async () => {
  useProgress.setState({ pending: 0 });
  render(<ProgressBar delayMs={0} />);
  act(() => useProgress.setState({ pending: 1 }));
  expect(await screen.findByRole('progressbar')).toBeTruthy();
  act(() => useProgress.setState({ pending: 0 }));
  expect(screen.queryByRole('progressbar')).toBeNull();
});
