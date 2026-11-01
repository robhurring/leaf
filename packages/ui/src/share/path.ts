// A relay serves this page at /s/<id>/…: the share's id picks the router's base and the socket.
const SHARE_PATH = /^\/s\/([a-z]+-[a-z]+-[a-z]+)(\/|$)/;
export const NAME_KEY = 'leaf.share.name';

export const shareIdFromPath = (pathname: string): string | null =>
  SHARE_PATH.exec(pathname)?.[1] ?? null;

/** The router's base: `/s/<id>` in a share, else the root. */
export const shareBase = (pathname: string) => {
  const id = shareIdFromPath(pathname);
  return id ? `/s/${id}` : '';
};

export function wsUrl(loc: Location): string {
  const override = new URLSearchParams(loc.search).get('ws');
  if (override) return override;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${shareBase(loc.pathname)}/ws`;
}

/** The name this browser goes by in shares; storage can be unavailable. */
export function savedShareName(): string | undefined {
  try {
    return localStorage.getItem(NAME_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
