// Inline matchers: a regex over text nodes (outside code, links, and kbd) and a
// function from the match to a link, a styled span, or a React node.
import type { ReactNode } from 'react';
import type { Config } from '@leaf/protocol';
import type { Handlers } from '../handlers.js';
import { mention } from '../inline/mention.js';
import { topic } from '../inline/topic.js';

export type InlineCtx = { docPath: string; config: Config; handlers?: Handlers };
export type InlineResult = { href?: string; label?: string; className?: string } | ReactNode;
export type InlineMatcher = {
  name: string;
  /** Must have the `g` flag. */
  pattern: RegExp;
  render: (match: RegExpMatchArray, ctx: InlineCtx) => InlineResult;
};

export type InlineRegistry = {
  register(matcher: InlineMatcher): () => void;
  all(): InlineMatcher[];
};

export function createInlineRegistry(builtins: InlineMatcher[] = [mention, topic]): InlineRegistry {
  const matchers: InlineMatcher[] = [...builtins];
  return {
    register(matcher) {
      if (!matcher.pattern.global)
        throw new Error(`inline matcher ${matcher.name}: pattern needs the g flag`);
      const i = matchers.findIndex((m) => m.name === matcher.name);
      if (i >= 0) matchers[i] = matcher;
      else matchers.push(matcher);
      return () => {
        const j = matchers.indexOf(matcher);
        if (j >= 0) matchers.splice(j, 1);
      };
    },
    all() {
      return [...matchers];
    },
  };
}
