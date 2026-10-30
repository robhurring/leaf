// A block's source, highlighted: what a diagram, chart, map, or animation is made of.
// Plain text first, colors once the highlighter has the language.
import { useEffect, useState } from 'react';
import type { Element } from 'hast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { highlightToHast } from '../render/highlight.js';

export function SourceView({ code, lang }: { code: string; lang: string }) {
  const [hast, setHast] = useState<{ code: string; el: Element } | null>(null);
  useEffect(() => {
    let live = true;
    highlightToHast(code, lang).then(
      (el) => live && el && setHast({ code, el }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [code, lang]);
  return (
    <div className="leaf-block-source">
      {hast?.code === code ? (
        toJsxRuntime(hast.el, { Fragment, jsx, jsxs })
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/** The language a block's source is written in, for highlighting. */
export function sourceLang(viewerId: string, lang: string | undefined): string {
  if (viewerId === 'chart') return 'yaml';
  if (viewerId === 'map') return lang === 'map' ? 'yaml' : 'json';
  if (viewerId === 'live') return 'javascript';
  if (viewerId === 'excalidraw') return 'json';
  return lang ?? 'text';
}
