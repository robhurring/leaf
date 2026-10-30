// `<!--table:filter-->` on the line before a markdown table gives it a filter bar.
// The comment itself renders as nothing, as it would on GitHub.
import type { Root, RootContent, Table } from 'mdast';
import { visit } from 'unist-util-visit';

const FILTER = /^<!--\s*table:filter\s*-->$/;

export function remarkTableOptions() {
  return (tree: Root) => {
    visit(tree, (node) => {
      const children = (node as { children?: RootContent[] }).children;
      if (!children) return;
      for (let i = 0; i < children.length - 1; i++) {
        const c = children[i]!;
        const next = children[i + 1]!;
        if (c.type !== 'html' || !FILTER.test(c.value.trim()) || next.type !== 'table') continue;
        const table = next as Table;
        table.data = {
          ...table.data,
          hProperties: { ...table.data?.hProperties, dataFilter: 'true' },
        };
        children.splice(i, 1);
      }
    });
  };
}
