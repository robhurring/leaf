// Parses the YAML frontmatter node into file.data.frontmatter and removes it.
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { track } from '../progress.js';
import { load } from '../connection.js';

export function remarkFrontmatterData() {
  return async (tree: Root, file: VFile) => {
    const i = tree.children.findIndex((n) => n.type === 'yaml');
    if (i < 0) return;
    const node = tree.children[i] as { value: string };
    // The YAML parser loads only for documents that have frontmatter.
    const { parse } = await track(load(() => import('yaml')));
    try {
      file.data.frontmatter = parse(node.value) as Record<string, unknown>;
    } catch {
      file.data.frontmatter = { raw: node.value };
    }
    tree.children.splice(i, 1);
  };
}
