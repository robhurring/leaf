import { useContext } from 'react';
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
        className="leaf-image"
        src={resolved}
        alt={props.alt ?? ''}
        title={props.title}
        data-pos={props['data-pos']}
        loading="lazy"
      />
    );
  };
}
