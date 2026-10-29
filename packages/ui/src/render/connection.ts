// Whether the leaf server can be reached. While it can't, spinners give way to a
// disconnected mark (data-connection="lost" on <html>), and code chunks that failed to
// download wait for the socket to come back and try again.
import { create } from 'zustand';
// The source's connection states (source/DocumentSource), spelled out: render/ stays
// independent of source/.
type SourceStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export const useConnection = create<{ status: SourceStatus; offline: boolean }>(() => ({
  status: 'connecting',
  offline: false,
}));

const isOffline = (s: SourceStatus) => s === 'reconnecting' || s === 'closed';

export function setConnection(status: SourceStatus): void {
  const offline = isOffline(status);
  useConnection.setState({ status, offline });
  const root = document.documentElement;
  if (offline) root.dataset.connection = 'lost';
  else delete root.dataset.connection;
}

function whenOnline(): Promise<void> {
  if (!useConnection.getState().offline) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useConnection.subscribe((s) => {
      if (s.offline) return;
      off();
      resolve();
    });
  });
}

// What browsers say when a module or resource could not be fetched.
const FETCH_FAILED =
  /dynamically imported module|importing a module script failed|failed to fetch|networkerror|load failed/i;
const fetchFailed = (e: unknown) => e instanceof Error && FETCH_FAILED.test(e.message);

// Safari remembers a module that failed to download and fails every later import of
// it without asking the server again. When that happens after an outage, reloading the
// page is the only way to get the module; once a minute at most, so it can't loop.
const RELOADED_KEY = 'leaf.reloadedAt';
function reloadOnce(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY)) || 0;
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return;
  }
  location.reload();
}

/**
 * Runs `fn` (an import or fetch), and when it fails for want of the server, tries again
 * once the server is back, as often as it takes. With the server up a failed fetch is
 * tried once more after `retryMs` (the socket may not have noticed the drop yet), then
 * the error stands: a chunk a rebuild removed will never load. A fetch that failed in an
 * outage and still fails after it reloads the page (see reloadOnce).
 */
export async function load<T>(
  fn: () => Promise<T>,
  opts: { retryMs?: number; reload?: () => void } = {},
): Promise<T> {
  let retriedOnline = false;
  let outage = false;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!fetchFailed(e)) throw e;
      if (!useConnection.getState().offline) {
        if (retriedOnline) {
          if (outage) (opts.reload ?? reloadOnce)();
          throw e;
        }
        retriedOnline = true;
        await new Promise((r) => setTimeout(r, opts.retryMs ?? 1500));
      }
      if (useConnection.getState().offline) {
        outage = true;
        retriedOnline = false;
      }
      await whenOnline();
    }
  }
}
