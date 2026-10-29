// Code: fenced blocks are highlighted by the markdown pipeline (shiki); whole
// text files get a read-only CodeMirror editor with line numbers and search.
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DocToolsContext } from '../../components/Properties.js';
import type { EditorView } from '@codemirror/view';
import type { Viewer, ViewerProps } from '../types.js';
import { BinaryCard } from '../binary/index.js';
import { track } from '../../render/progress.js';
import { load } from '../../render/connection.js';
import { Check, Copy, WrapText } from '../../icons/index.js';
import { useAppearance } from '../appearance.js';

/** `#L3` or `#L3-L7` → a 1-based line range. */
export function parseLineHash(hash: string): { from: number; to: number } | null {
  const m = /^#?L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export const lineHash = (r: { from: number; to: number }) =>
  r.from === r.to ? `#L${r.from}` : `#L${r.from}-L${r.to}`;

function CodeInline({ content, file }: ViewerProps) {
  return (
    <pre className="leaf-block leaf-codeblock" data-lang={file.lang ?? 'text'}>
      <code>{content ?? ''}</code>
    </pre>
  );
}

export function CodeRich(props: ViewerProps) {
  const { file, content } = props;
  const host = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const inlined = file.encoding === 'utf8' && content !== undefined;
  const dark = useAppearance(props.appearance) === 'dark';
  const viewRef = useRef<EditorView | null>(null);
  // Showing a whole file: the controls go in the file header and the editor fills the area.
  const slot = useContext(DocToolsContext);

  const editorRef = useRef<typeof import('./editor.js') | null>(null);
  useEffect(() => {
    if (viewRef.current && editorRef.current) editorRef.current.setDark(viewRef.current, dark);
  }, [dark]);

  useEffect(() => {
    if (!inlined || !host.current) return;
    const parent = host.current;
    let view: EditorView | null = null;
    let gone = false;
    // CodeMirror loads the first time a code file (or a zoomed code block) opens.
    void track(load(() => import('./editor.js'))).then((editor) => {
      if (gone) return;
      editorRef.current = editor;
      view = editor.createReadOnlyView(
        parent,
        content,
        file.lang,
        file.path,
        wrap,
        (range) => history.replaceState(history.state, '', lineHash(range)),
        dark,
      );
      viewRef.current = view;
      const initial = parseLineHash(location.hash);
      if (initial) {
        editor.selectLines(view, initial.from, false);
        if (initial.to !== initial.from) editor.selectLines(view, initial.to, true);
      }
    });
    return () => {
      gone = true;
      viewRef.current = null;
      view?.destroy();
    };
    // `dark` is applied through setDark, not by rebuilding the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlined, content, file.lang, file.path, wrap]);

  if (!inlined) return <BinaryCard {...props} />;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const tools = (
    <>
      <span className="leaf-block-lang">{file.lang ?? 'text'}</span>
      <span className="leaf-code-file-lines">{content.split('\n').length} lines</span>
      <button
        type="button"
        className="leaf-tool"
        aria-label="Wrap lines"
        aria-pressed={wrap}
        onClick={() => setWrap((w) => !w)}
        title="Wrap lines"
      >
        <WrapText size={15} />
      </button>
      <button
        type="button"
        className="leaf-tool"
        aria-label="Copy"
        onClick={copy}
        title={copied ? 'Copied' : 'Copy'}
        data-result={copied ? 'ok' : undefined}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </>
  );

  return (
    <div
      className="leaf-code-file"
      data-lang={file.lang ?? 'text'}
      data-full={slot ? '' : undefined}
    >
      {slot ? createPortal(tools, slot) : <div className="leaf-code-file-bar">{tools}</div>}
      <div ref={host} className="leaf-code-file-editor" />
    </div>
  );
}

export const code: Viewer = {
  id: 'code',
  matches: { kind: ['text'] },
  Inline: CodeInline,
  Rich: CodeRich,
};
