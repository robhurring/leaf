// Runs the inline matcher registry over text nodes that are not inside code,
// links, or kbd. Results become <a>/<span> elements, or placeholders for React nodes.
import type { Root, Element, Text, ElementContent, Parents } from 'hast';
import { visit, SKIP } from 'unist-util-visit';
import type { ReactNode } from 'react';
import type { InlineCtx, InlineMatcher } from '../registries/inline.js';

const SKIP_INSIDE = new Set([
  'code',
  'pre',
  'a',
  'kbd',
  'script',
  'style',
  'leaf-code',
  'leaf-node',
]);

export type NodeSlots = ReactNode[];

export function rehypeInline(matchers: InlineMatcher[], ctx: InlineCtx, slots: NodeSlots) {
  return () => (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'element' && SKIP_INSIDE.has(node.tagName)) return SKIP;
      if (node.type !== 'text' || !parent || index === undefined) return;
      const replacement = applyMatchers(node, matchers, ctx, slots);
      if (replacement) {
        (parent as Parents).children.splice(index, 1, ...replacement);
        return index + replacement.length;
      }
    });
  };
}

function applyMatchers(
  text: Text,
  matchers: InlineMatcher[],
  ctx: InlineCtx,
  slots: NodeSlots,
): ElementContent[] | null {
  let nodes: ElementContent[] = [text];
  let changed = false;
  for (const matcher of matchers) {
    const next: ElementContent[] = [];
    for (const n of nodes) {
      if (n.type !== 'text') {
        next.push(n);
        continue;
      }
      let last = 0;
      for (const m of n.value.matchAll(matcher.pattern)) {
        const at = m.index ?? 0;
        if (at > last) next.push({ type: 'text', value: n.value.slice(last, at) });
        next.push(toNode(matcher.render(m, ctx), m[0], slots));
        last = at + m[0].length;
        changed = true;
      }
      if (last < n.value.length) next.push({ type: 'text', value: n.value.slice(last) });
    }
    nodes = next;
  }
  return changed ? nodes : null;
}

function toNode(
  result: ReturnType<InlineMatcher['render']>,
  matched: string,
  slots: NodeSlots,
): ElementContent {
  if (result && typeof result === 'object' && !isReactNode(result)) {
    const r = result as { href?: string; label?: string; className?: string };
    const label = r.label ?? matched;
    const base: Element = {
      type: 'element',
      tagName: 'span',
      properties: { className: r.className ? [r.className] : undefined },
      children: [{ type: 'text', value: label }],
    };
    if (r.href) return { ...base, tagName: 'a', properties: { ...base.properties, href: r.href } };
    return base;
  }
  if (result === null || result === undefined) return { type: 'text', value: matched };
  slots.push(result as ReactNode);
  return {
    type: 'element',
    tagName: 'leaf-node',
    properties: { 'data-slot': String(slots.length - 1) },
    children: [],
  };
}

function isReactNode(v: object): boolean {
  return '$$typeof' in v || Array.isArray(v);
}
