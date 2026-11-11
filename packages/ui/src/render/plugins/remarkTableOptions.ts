// `<!--table:filter-->` on the line before a markdown table gives it a filter bar. The comment itself
// renders as nothing, as it would on GitHub. Every table sorts by its headers now, so `sort` is still
// read (`<!--table:sort-->`, `<!--table:filter sort-->`) and changes nothing.
import type { Root, RootContent, Table } from 'mdast';
import { visit } from 'unist-util-visit';

const OPTIONS = /^<!--\s*table:((?:\s*(?:filter|sort))+)\s*-->$/;

export function remarkTableOptions() {
  return (tree: Root) => {
    visit(tree, (node) => {
      const children = (node as { children?: RootContent[] }).children;
      if (!children) return;
      for (let i = 0; i < children.length - 1; i++) {
        const c = children[i]!;
        const next = children[i + 1]!;
        if (c.type !== 'html' || next.type !== 'table') continue;
        const m = OPTIONS.exec(c.value.trim());
        if (!m) continue;
        const words = new Set(m[1]!.trim().split(/\s+/));
        const table = next as Table;
        table.data = {
          ...table.data,
          hProperties: {
            ...table.data?.hProperties,
            ...(words.has('filter') ? { dataFilter: 'true' } : {}),
          },
        };
        children.splice(i, 1);
      }
    });
  };
}
