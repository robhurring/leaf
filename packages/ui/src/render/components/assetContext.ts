// How a rendered document turns a relative asset path into something an <img>
// can load. The default is the server's /raw endpoint; the app overrides it
// when the source has no HTTP (assets then arrive over the socket).
import { createContext } from 'react';

/** A URL for the asset, or null while its bytes are still on the way. */
export type AssetResolver = (path: string) => string | null;
export const AssetContext = createContext<AssetResolver | null>(null);
export const rawUrl: AssetResolver = (path) =>
  '/raw/' + path.split('/').map(encodeURIComponent).join('/');
