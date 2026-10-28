import { Markdown } from '../../components/Markdown.js';
import { BinaryCard } from '../binary/index.js';
import type { Viewer, ViewerProps } from '../types.js';

function MarkdownViewer(props: ViewerProps) {
  const { file, content, docPath, config, handlers, numbering, linkBase } = props;
  // Over LEAF_MAX_INLINE_BYTES the server sends no content: show the file's facts, not a blank page.
  if (file.encoding !== 'utf8' || content === undefined) return <BinaryCard {...props} />;
  return (
    <Markdown
      source={content}
      docPath={docPath || file.path}
      config={config}
      handlers={handlers}
      numbering={numbering}
      linkBase={linkBase}
    />
  );
}

export const markdown: Viewer = {
  id: 'markdown',
  matches: { ext: ['.md', '.markdown'], mime: ['text/markdown'], kind: ['markdown'] },
  Inline: MarkdownViewer,
  Rich: MarkdownViewer,
};
