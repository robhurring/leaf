// Links: relative markdown links navigate within the tree, other relative links
// open the raw file, absolute URLs open in a new tab. Hosts override via resolveLink.
import type { ReactNode } from 'react';
import type { Handlers } from '../handlers.js';
import { resolveRelative, isAbsoluteUrl } from '../paths.js';

export type LinkDeps = { docPath: string; handlers?: Handlers; linkBase: string };

type Props = {
  href?: string;
  className?: string;
  'data-pos'?: string;
  children?: ReactNode;
  title?: string;
};

export function link(deps: LinkDeps) {
  return function Link(props: Props) {
    const href = props.href ?? '';
    const common = {
      title: props.title,
      className: props.className,
      'data-pos': props['data-pos'],
    };
    const resolved = resolve(href, deps);
    if ('navigate' in resolved) {
      return (
        <a {...common} href={`${deps.linkBase}/${resolved.navigate}`} data-nav={resolved.navigate}>
          {props.children}
        </a>
      );
    }
    if ('external' in resolved) {
      return (
        <a {...common} href={resolved.external} target="_blank" rel="noreferrer">
          {props.children}
        </a>
      );
    }
    return (
      <a {...common} href={resolved.href}>
        {props.children}
      </a>
    );
  };
}

function resolve(
  href: string,
  deps: LinkDeps,
): { navigate: string } | { external: string } | { href: string } {
  const custom = deps.handlers?.resolveLink?.(href, { docPath: deps.docPath });
  if (custom !== undefined) return typeof custom === 'string' ? { href: custom } : custom;
  if (href.startsWith('#') || href === '' || href.startsWith('/')) return { href };
  if (isAbsoluteUrl(href)) return href.startsWith('mailto:') ? { href } : { external: href };
  const [pathPart, hash] = href.split('#', 2);
  // Every file kind has a viewer, so any relative link to a file stays in the app.
  const target = resolveRelative(deps.docPath, pathPart!);
  return { navigate: hash ? `${target}#${hash}` : target };
}
