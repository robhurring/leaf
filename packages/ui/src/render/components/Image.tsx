import { useContext, useEffect, useState } from 'react';
import { useConnection } from '../connection.js';
import { resolveRelative, isAbsoluteUrl } from '../paths.js';
import { AssetContext, rawUrl } from './assetContext.js';

type Props = { src?: string; alt?: string; title?: string; 'data-pos'?: string };

export function image(docPath: string) {
  return function Image(props: Props) {
    const src = props.src ?? '';
    const resolve = useContext(AssetContext) ?? rawUrl;
    const resolved =
      isAbsoluteUrl(src) || src.startsWith('/') || src.startsWith('data:')
        ? src
        : resolve(resolveRelative(docPath, src));
    // An image that failed while the server was out of reach loads again once it is back.
    const offline = useConnection((s) => s.offline);
    const [failedOffline, setFailedOffline] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (offline || !failedOffline) return;
      setFailedOffline(false);
      setAttempt((n) => n + 1);
    }, [offline, failedOffline]);
    if (failedOffline)
      return (
        <span
          className="leaf-image-pending leaf-image-offline"
          role="img"
          aria-label={`${props.alt || 'Image'}, waiting for leaf`}
          data-pos={props['data-pos']}
        />
      );
    if (resolved === null)
      return (
        <span
          className="leaf-image-pending"
          role="img"
          aria-busy="true"
          aria-label={`Loading ${props.alt || 'image'}`}
          data-pos={props['data-pos']}
        />
      );
    return (
      <img
        key={attempt}
        className="leaf-image"
        src={resolved}
        alt={props.alt ?? ''}
        title={props.title}
        data-pos={props['data-pos']}
        loading="lazy"
        onError={() => {
          if (useConnection.getState().offline) setFailedOffline(true);
        }}
      />
    );
  };
}
