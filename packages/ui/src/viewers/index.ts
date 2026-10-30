import { createElement } from 'react';
import { BlockFrame } from '../components/BlockFrame.js';
import { registries } from '../render/registries/index.js';
import { createViewerRegistry } from './registry.js';
import type { ViewerProps } from './types.js';
import { binary } from './binary/index.js';
import { code } from './code/index.js';
import { live } from './live/index.js';
import { chart } from './chart/index.js';
import { map } from './map/index.js';
import { deck } from './deck/index.js';
import { notebook } from './notebook/index.js';
import { csv } from './csv/index.js';
import { excalidraw } from './excalidraw/index.js';
import { mermaid } from './mermaid/index.js';
import { plantuml } from './plantuml/index.js';
import { image } from './image/index.js';
import { markdown } from './markdown/index.js';
import { media } from './media/index.js';
import { draw } from './draw/index.js';

/** The app-wide viewer registry with the built-in viewers. */
export const viewers = createViewerRegistry();
for (const v of [
  markdown,
  mermaid,
  plantuml,
  excalidraw,
  csv,
  live,
  chart,
  map,
  draw,
  deck,
  notebook,
  code,
  image,
  media,
  binary,
])
  viewers.register(v);

// A viewer that claims fence languages renders those blocks inline, inside the
// shared block frame (zoom in, copy, download).
for (const v of viewers.all()) {
  for (const lang of v.matches.lang ?? []) {
    registries.blocks.register({
      lang,
      render: (code, meta, ctx) => {
        const props: ViewerProps = {
          file: {
            type: 'file',
            path: `${ctx.docPath}#${lang}`,
            kind: 'text',
            mime: 'text/plain',
            encoding: 'utf8',
            url: '',
            size: code.length,
            mtime: 0,
            content: code,
          },
          content: code,
          meta,
          docPath: ctx.docPath,
          config: ctx.config,
        };
        return createElement(BlockFrame, {
          viewer: v,
          props,
          lang,
          children: createElement(v.Inline, props),
        });
      },
    });
  }
}

export { createViewerRegistry } from './registry.js';
export type { Viewer, ViewerProps, Action } from './types.js';
export {
  markdown,
  mermaid,
  plantuml,
  excalidraw,
  csv,
  live,
  chart,
  map,
  deck,
  notebook,
  code,
  image,
  media,
  binary,
};
