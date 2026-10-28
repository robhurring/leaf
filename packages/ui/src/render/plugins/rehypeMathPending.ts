// Before KaTeX has loaded, each formula renders as a small loading placeholder that
// keeps its source text; the full render replaces it with typeset math.
import type { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

const classes = (n: Element) => (n.properties.className as string[] | undefined) ?? [];

export function rehypeMathPending() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (index === undefined || !parent) return;
      const isPre = node.tagName === 'pre' && node.children[0]?.type === 'element';
      const target = isPre ? (node.children[0] as Element) : node;
      // Sanitizing keeps `language-math` (and drops math-inline/math-display); a formula in
      // a <pre> is display math.
      const c = classes(target);
      if (!c.includes('language-math') && !c.includes('math-inline') && !c.includes('math-display'))
        return;
      if (target.tagName !== 'code') return;
      const display = isPre || c.includes('math-display');
      (parent.children as unknown[])[index] = {
        type: 'element',
        tagName: display ? 'div' : 'span',
        properties: {
          className: ['leaf-math-pending', display ? 'leaf-math-display' : 'leaf-math-inline'],
          ariaBusy: 'true',
          title: 'Loading math',
        },
        children: [{ type: 'text', value: toString(target) }],
      } satisfies Element;
    });
  };
}
