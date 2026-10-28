// Extra remark/rehype plugins appended to the pipeline, in registration order.
import type { Plugin } from 'unified';

export type ParserEntry = {
  plugin: Plugin<never[], never, never>;
  options?: unknown;
  stage: 'remark' | 'rehype';
};

export type ParserRegistry = {
  use(plugin: ParserEntry['plugin'], options?: unknown, stage?: ParserEntry['stage']): () => void;
  all(stage: ParserEntry['stage']): ParserEntry[];
};

export function createParserRegistry(): ParserRegistry {
  const entries: ParserEntry[] = [];
  return {
    use(plugin, options, stage = 'remark') {
      const entry = { plugin, options, stage };
      entries.push(entry);
      return () => {
        const i = entries.indexOf(entry);
        if (i >= 0) entries.splice(i, 1);
      };
    },
    all(stage) {
      return entries.filter((e) => e.stage === stage);
    },
  };
}
