// Resolves every fenced block: host handlers → block registry → unknown-block
// handler → shiki. Runs inside the async pipeline so static renders are highlighted.
import type { Root, Element, Text } from 'hast';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import type { ReactNode } from 'react';
import type { Handlers } from '../handlers.js';
import { highlightToHast } from '../highlight.js';
import type { BlockCtx, BlockRegistry } from '../registries/blocks.js';
import type { NodeSlots } from './rehypeInline.js';

export type CodeBlockDeps = {
  handlers?: Handlers;
  blocks: BlockRegistry;
  ctx: BlockCtx;
  slots: NodeSlots;
  /** False: plain code, no wait for the highlighter. */
  highlight?: boolean;
};

export function rehypeCodeBlocks(deps: CodeBlockDeps) {
  return () => async (tree: Root) => {
    const targets: { node: Element; index: number; parent: { children: unknown[] } }[] = [];
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || index === undefined || !parent) return;
      const code = node.children[0];
      if (!code || code.type !== 'element' || code.tagName !== 'code') return;
      targets.push({ node, index, parent: parent as { children: unknown[] } });
    });
    // Blocks resolve in parallel: languages load concurrently instead of one by one.
    // Slots are reserved in document order first so their indexes stay stable.
    const resolved = await Promise.all(
      targets.map(({ node }) => {
        const code = node.children[0] as Element;
        const className = (code.properties.className as string[] | undefined) ?? [];
        const lang = (
          className.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? 'text'
        ).toLowerCase();
        const meta = String((code.data as { meta?: string } | undefined)?.meta ?? '');
        const source = toString(code).replace(/\n$/, '');
        return resolveBlock(lang, source, meta, deps, node);
      }),
    );
    targets.forEach(({ index, parent }, i) => {
      parent.children[index] = resolved[i];
    });
  };
}

async function resolveBlock(
  lang: string,
  source: string,
  meta: string,
  deps: CodeBlockDeps,
  original: Element,
): Promise<Element> {
  // The fence's source lines (from rehypePos) stay on whatever replaces it.
  const pos = original.properties['data-pos'] as string | undefined;
  const custom = deps.handlers?.renderBlock?.(lang, source, meta);
  if (custom !== undefined) return slot(custom, deps.slots, pos);
  const entry = deps.blocks.resolve(lang);
  if (entry) return slot(entry.render(source, meta, deps.ctx), deps.slots, pos);
  const unknown = deps.handlers?.onUnknownBlock?.(lang, source);
  if (unknown !== undefined) return slot(unknown, deps.slots, pos);
  const highlighted = deps.highlight === false ? null : await highlightToHast(source, lang);
  return {
    type: 'element',
    tagName: 'leaf-code',
    properties: {
      'data-lang': lang,
      'data-meta': meta || undefined,
      'data-code': source,
      'data-doc': deps.ctx.docPath,
      'data-pos': pos,
    },
    position: original.position,
    children: highlighted
      ? [highlighted]
      : [{ ...original, children: [{ type: 'text', value: source } as Text] }],
  };
}

function slot(node: ReactNode, slots: NodeSlots, pos?: string): Element {
  slots.push(node);
  return {
    type: 'element',
    tagName: 'leaf-node',
    properties: { 'data-slot': String(slots.length - 1), 'data-pos': pos },
    children: [],
  };
}
