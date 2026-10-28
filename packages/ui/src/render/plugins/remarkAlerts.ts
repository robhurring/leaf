// GitHub alerts: a blockquote starting with [!NOTE] etc. becomes
// <div class="leaf-alert leaf-alert-note"><p class="leaf-alert-title">Note</p>…</div>
import type { Root, Blockquote, Paragraph, Text } from 'mdast';
import { visit } from 'unist-util-visit';

const TYPES: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};
const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/;

export function remarkAlerts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0];
      if (!first || first.type !== 'paragraph') return;
      const text = first.children[0];
      if (!text || text.type !== 'text') return;
      const m = MARKER.exec(text.value);
      if (!m) return;
      const kind = m[1]!.toLowerCase();
      text.value = text.value.slice(m[0].length);
      if (text.value === '') first.children.shift();
      if (first.children.length === 0) node.children.shift();
      const title: Paragraph = {
        type: 'paragraph',
        data: { hProperties: { className: ['leaf-alert-title'] } },
        children: [{ type: 'text', value: TYPES[m[1]!]! } as Text],
      };
      node.children.unshift(title);
      node.data = {
        ...node.data,
        hName: 'div',
        hProperties: { className: ['leaf-alert', `leaf-alert-${kind}`], dataAlert: kind },
      };
    });
  };
}
