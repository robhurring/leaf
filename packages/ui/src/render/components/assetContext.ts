// How a rendered document turns a relative asset path into something an <img>
// can load. The default is the server's /raw endpoint; a source that serves bytes
// elsewhere (the app's leaf-raw://) names its base, and one that serves none sends
// them over the socket.
import { createContext } from 'react';

/** A URL for the asset, or null while its bytes are still on the way. */
export type AssetResolver = (path: string) => string | null;
export const AssetContext = createContext<AssetResolver | null>(null);
/** Where the source serves `path`'s bytes: `/raw/` on a server, the app's own base in a window. */
export const rawUrl = (path: string, base = '/raw/'): string =>
  base + path.split('/').map(encodeURIComponent).join('/');
