import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { load, setConnection, useConnection } from '../src/render/connection.js';
import { Loading } from '../src/components/Loading.js';
import { ProgressBar } from '../src/components/ProgressBar.js';
import { image } from '../src/render/components/Image.js';
import { useProgress } from '../src/render/progress.js';
import { fireEvent, act } from '@testing-library/react';

beforeEach(() => setConnection('open'));

const offline = () => new TypeError('Failed to fetch dynamically imported module: /assets/x.js');

describe('loading through a lost connection', () => {
  it('a load that fails while disconnected waits for the server, then tries again', async () => {
    setConnection('reconnecting');
    let calls = 0;
    const fn = vi.fn(async () => {
      if (++calls === 1) throw offline();
      return 'engine';
    });
    const p = load(fn);
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
    setConnection('open');
    await expect(p).resolves.toBe('engine');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a fetch failure noticed before the socket drops still waits for the server', async () => {
    let calls = 0;
    const p = load(
      async () => {
        if (++calls === 1) {
          setConnection('reconnecting');
          throw offline();
        }
        return 'ok';
      },
      { retryMs: 5 },
    );
    await new Promise((r) => setTimeout(r, 20));
    setConnection('open');
    await expect(p).resolves.toBe('ok');
  });

  it('a download that failed in the outage and still fails once back reloads the page (Safari keeps failed modules)', async () => {
    setConnection('reconnecting');
    const reload = vi.fn();
    const fn = vi.fn(async () => {
      throw offline();
    });
    const p = load(fn, { retryMs: 1, reload });
    await new Promise((r) => setTimeout(r, 10));
    setConnection('open');
    await expect(p).rejects.toThrow('Failed to fetch');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('other errors are not retried', async () => {
    const fn = vi.fn(async () => {
      throw new Error('Parse error on line 2');
    });
    await expect(load(fn)).rejects.toThrow('Parse error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a missing file with the server up fails after one retry instead of looping', async () => {
    const fn = vi.fn(async () => {
      throw offline();
    });
    await expect(load(fn, { retryMs: 1 })).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('marks the page while the connection is lost', () => {
    setConnection('reconnecting');
    expect(document.documentElement.dataset.connection).toBe('lost');
    expect(useConnection.getState().offline).toBe(true);
    setConnection('open');
    expect(document.documentElement.dataset.connection).toBeUndefined();
  });

  it('the document loader says it is waiting instead of spinning', () => {
    setConnection('reconnecting');
    render(<Loading label="guide.md" delayMs={0} />);
    expect(screen.getByRole('status').textContent).toMatch(/waiting for leaf/i);
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeTruthy();
    expect(document.querySelector('.leaf-spinner')).toBeNull();
  });

  it('an image that fails while disconnected shows the mark, then loads when the server is back', () => {
    const Image = image('docs/a.md');
    render(<Image src="pic.png" alt="Chart" />);
    act(() => setConnection('reconnecting'));
    fireEvent.error(screen.getByRole('img', { name: 'Chart' }));
    expect(screen.getByRole('img', { name: /Chart, waiting for leaf/ })).toBeTruthy();
    act(() => setConnection('open'));
    const img = screen.getByRole('img', { name: 'Chart' });
    expect(img.tagName).toBe('IMG');
  });

  it('a broken image with the server up stays a broken image', () => {
    const Image = image('docs/a.md');
    render(<Image src="missing.png" alt="Gone" />);
    fireEvent.error(screen.getByRole('img', { name: 'Gone' }));
    expect(screen.getByRole('img', { name: 'Gone' }).tagName).toBe('IMG');
  });

  it('the progress bar steps aside while disconnected', async () => {
    useProgress.setState({ pending: 1 });
    render(<ProgressBar delayMs={0} />);
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    act(() => setConnection('reconnecting'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    useProgress.setState({ pending: 0 });
  });
});
