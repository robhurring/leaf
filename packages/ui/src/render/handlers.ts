// Per-instance overrides a host app can pass to <Reader> or <Markdown>.
import type { ReactNode } from 'react';

export type LinkResolution = string | { navigate: string } | { external: string };

export interface Handlers {
  resolveLink?(href: string, ctx: { docPath: string }): LinkResolution;
  onMention?(username: string): { href?: string; label?: string } | ReactNode;
  onTopic?(topic: string): { href?: string; label?: string } | ReactNode;
  renderBlock?(lang: string, code: string, meta: string): ReactNode | undefined;
  onUnknownBlock?(lang: string, code: string): ReactNode | undefined;
}
