// A fenced code block inside the shared block frame: copy, and zoom in (which
// opens the read-only editor in the Stage). Injected into the pipeline by <Markdown>.
import type { ReactNode } from 'react';
import { code } from '../viewers/code/index.js';
import type { ViewerProps } from '../viewers/types.js';
import { BlockFrame } from './BlockFrame.js';

type Props = {
  'data-lang'?: string;
  'data-code'?: string;
  'data-doc'?: string;
  'data-pos'?: string;
  children?: ReactNode;
};

export function FramedCodeBlock(props: Props) {
  const lang = props['data-lang'] ?? 'text';
  const source = props['data-code'] ?? '';
  const docPath = props['data-doc'] ?? '';
  const viewerProps: ViewerProps = {
    file: {
      type: 'file',
      path: `${docPath}#${lang}`,
      kind: 'text',
      lang,
      mime: 'text/plain',
      encoding: 'utf8',
      url: '',
      size: source.length,
      mtime: 0,
      content: source,
    },
    content: source,
    docPath,
    config: {},
  };
  return (
    <BlockFrame
      viewer={code}
      props={viewerProps}
      lang={lang}
      className="leaf-codeblock"
      data-pos={props['data-pos']}
    >
      {props.children}
    </BlockFrame>
  );
}
