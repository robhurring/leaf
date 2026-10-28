// Heading metadata shared by the document, the outline, and the palette.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import { githubSlug } from './slug.js';

export type Heading = {
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
  line: number;
  number?: string;
};

/**
 * Assigns `1`, `1.1`, `1.1.1` numbers to h2+ in document order. A heading that
 * skips levels (h2 → h4) is numbered under its nearest shallower ancestor.
 */
export function numberHeadings(headings: Heading[]): Heading[] {
  const stack: { depth: number; n: number }[] = [];
  return headings.map((h) => {
    if (h.depth === 1) return { ...h, number: undefined };
    while (stack.length && stack[stack.length - 1]!.depth > h.depth) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.depth === h.depth) top.n++;
    else stack.push({ depth: h.depth, n: 1 });
    return { ...h, number: stack.map((s) => s.n).join('.') };
  });
}

export function extractHeadings(markdown: string): Heading[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkGfm)
    .parse(markdown) as Root;
  const seen = new Map<string, number>();
  const out: Heading[] = [];
  visit(tree, 'heading', (node) => {
    const text = toString(node);
    out.push({
      depth: node.depth,
      text,
      slug: githubSlug(text, seen),
      line: node.position?.start.line ?? 0,
    });
  });
  return numberHeadings(out);
}
