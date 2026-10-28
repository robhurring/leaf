import type { InlineMatcher } from '../registries/inline.js';

export const topic: InlineMatcher = {
  name: 'topic',
  pattern: /(?<![\w&#/-])#([\p{L}_][\p{L}\p{N}_-]*)/gu,
  render(m, ctx) {
    const t = m[1]!;
    const custom = ctx.handlers?.onTopic?.(t);
    if (custom !== undefined && custom !== null) {
      if (
        typeof custom === 'object' &&
        !('$$typeof' in (custom as object)) &&
        ('href' in custom || 'label' in custom)
      )
        return { ...(custom as { href?: string; label?: string }), className: 'leaf-topic' };
      return custom;
    }
    const href = ctx.config.topicUrl?.replace('{topic}', encodeURIComponent(t));
    return { href, className: 'leaf-topic' };
  },
};
