import type { InlineMatcher } from '../registries/inline.js';

/** Forges where `https://host/{username}` is a profile page. Used when LEAF_MENTION_URL is unset. */
const PROFILE_HOSTS = new Set(['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org']);

export function mentionUrlFor(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) return undefined;
  try {
    const host = new URL(repoUrl).hostname;
    return PROFILE_HOSTS.has(host) ? `https://${host}/{username}` : undefined;
  } catch {
    return undefined;
  }
}

export const mention: InlineMatcher = {
  name: 'mention',
  // Not preceded by a word char, dot, slash, or another @ (so emails and paths stay alone).
  pattern: /(?<![\w.@/-])@([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu,
  render(m, ctx) {
    const username = m[1]!;
    const custom = ctx.handlers?.onMention?.(username);
    if (custom !== undefined && custom !== null) {
      if (
        typeof custom === 'object' &&
        !('$$typeof' in (custom as object)) &&
        ('href' in custom || 'label' in custom)
      )
        return { ...(custom as { href?: string; label?: string }), className: 'leaf-mention' };
      return custom;
    }
    const href = ctx.config.mentionUrl?.replace('{username}', encodeURIComponent(username));
    return { href, className: 'leaf-mention' };
  },
};
