// Fenced-block renderers keyed by language. Viewers (mermaid, plantuml, …)
// register here; the default for unknown languages is the highlighted code view.
import type { ReactNode } from 'react';
import type { Config } from '@leaf/protocol';

export type BlockCtx = { docPath: string; config: Config };
export type BlockEntry = {
  lang: string | RegExp;
  render: (code: string, meta: string, ctx: BlockCtx) => ReactNode;
};

export type BlockRegistry = {
  register(entry: BlockEntry): () => void;
  resolve(lang: string): BlockEntry | undefined;
};

export function createBlockRegistry(): BlockRegistry {
  const entries: BlockEntry[] = [];
  return {
    register(entry) {
      entries.push(entry);
      return () => {
        const i = entries.indexOf(entry);
        if (i >= 0) entries.splice(i, 1);
      };
    },
    resolve(lang) {
      return entries.find((e) =>
        typeof e.lang === 'string' ? e.lang === lang : e.lang.test(lang),
      );
    },
  };
}
