// Carries source positions into the DOM as data-pos="L:C-L:C" so future
// overlays (comments, highlights) can anchor to markdown ranges.
import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

export function rehypePos() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const p = node.position;
      if (!p) return;
      node.properties['data-pos'] =
        `${p.start.line}:${p.start.column}-${p.end.line}:${p.end.column}`;
    });
  };
}
