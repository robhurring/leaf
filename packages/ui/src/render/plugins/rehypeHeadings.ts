// Gives every heading a GitHub slug id and a data-number, and records the list.
import type { Root, Element } from 'hast';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import { numberHeadings, type Heading } from '../headings.js';
import { githubSlug } from '../slug.js';

const DEPTH: Record<string, Heading['depth']> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

export function rehypeHeadings(collect: (headings: Heading[]) => void) {
  return () => (tree: Root) => {
    const seen = new Map<string, number>();
    const found: { node: Element; heading: Heading }[] = [];
    visit(tree, 'element', (node: Element) => {
      const depth = DEPTH[node.tagName];
      if (!depth) return;
      const text = toString(node);
      const slug = githubSlug(text, seen);
      node.properties.id = slug;
      found.push({ node, heading: { depth, text, slug, line: node.position?.start.line ?? 0 } });
    });
    const numbered = numberHeadings(found.map((f) => f.heading));
    numbered.forEach((h, i) => {
      if (h.number) found[i]!.node.properties['data-number'] = h.number;
    });
    collect(numbered);
  };
}
