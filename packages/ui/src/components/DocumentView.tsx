// Picks the viewer for the open file and intercepts in-document navigation.
import { useCallback, useContext, useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Config, ErrorMessage, FileMessage } from '@leaf/protocol';
import type { Handlers } from '../render/handlers.js';
import { viewers, deck } from '../viewers/index.js';
import { isMarp } from '../viewers/deck/detect.js';
import { BlockFrame } from './BlockFrame.js';
import { Loading } from './Loading.js';
import { DocToolsContext } from './Properties.js';
import { StageCanvas } from '../stage/Stage.js';
import { contentHash } from '../viewers/hash.js';
import { useAnnotations } from '../store/annotations.js';
import { Check, Code, Copy, X } from '../icons/index.js';
import { SourceView, sourceLang } from './SourceView.js';
import type { Viewer, ViewerProps } from '../viewers/types.js';

/** A file's kind by its extension: `sketch`, `csv`. */
const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** A whole diagram or image file: the Stage's pan, zoom, and drawing, in the panel. */
function InlineStage({
  viewer,
  props,
  slot,
}: {
  viewer: Viewer;
  props: ViewerProps;
  slot: HTMLElement;
}) {
  const blockHash = contentHash(props.content ?? props.file.path);
  // A file made from text (a diagram, chart, map, or animation) flips to that text.
  const [showSource, setShowSource] = useState(false);
  const hasSource =
    viewer.id !== 'image' &&
    !viewer.stage?.sheet &&
    props.file.encoding === 'utf8' &&
    !!props.content?.trim();
  useEffect(
    () => useAnnotations.getState().trackBlock(props.docPath, blockHash),
    [props.docPath, blockHash],
  );
  return (
    <div className="leaf-stage-inline">
      {hasSource &&
        createPortal(
          <button
            type="button"
            className="leaf-tool"
            aria-label="Show source"
            title={showSource ? 'Back to the picture' : 'Show the source'}
            aria-pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
          >
            <Code size={15} />
          </button>,
          slot,
        )}
      {showSource ? (
        <SourceView
          code={props.content ?? ''}
          lang={sourceLang(viewer.id, props.file.lang)}
          label={extOf(props.file.path)}
        />
      ) : (
        <StageCanvas
          // A picture with drawings starts over when it changes; a deck or a chart keeps
          // its place (the slide it's on) through an edit.
          key={viewer.stage?.zoom ? `${props.docPath}:${blockHash}` : props.docPath}
          content={{ docPath: props.docPath, blockHash, viewer, props }}
          toolsSlot={slot}
          inline
        />
      )}
    </div>
  );
}

/** A whole file that shows its text as something else (a CSV as a table): Show source
 *  and Copy source in the file toolbar. */
function WithSource({
  viewer,
  props,
  slot,
}: {
  viewer: Viewer;
  props: ViewerProps;
  slot: HTMLElement;
}) {
  const Rich = viewer.Rich;
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const text = props.content ?? '';
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => setCopied('ok'),
      () => setCopied('failed'),
    );
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <>
      {createPortal(
        <>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Show source"
            title={showSource ? 'Back to the table' : 'Show the source'}
            aria-pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
          >
            <Code size={15} />
          </button>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Copy source"
            title="Copy source"
            data-result={copied ?? undefined}
            onClick={() => void copy()}
          >
            {copied === 'ok' ? (
              <Check size={15} />
            ) : copied === 'failed' ? (
              <X size={15} />
            ) : (
              <Copy size={15} />
            )}
          </button>
        </>,
        slot,
      )}
      {showSource ? (
        <SourceView
          code={text}
          lang={sourceLang(viewer.id, props.file.lang)}
          label={extOf(props.file.path)}
        />
      ) : (
        <Rich {...props} />
      )}
    </>
  );
}

type Props = {
  file?: FileMessage;
  error?: ErrorMessage;
  path: string;
  config: Config;
  handlers?: Handlers;
  numbering: boolean;
  linkBase: string;
  onNavigate(target: string): void;
};

export function DocumentView({
  file,
  error,
  path,
  config,
  handlers,
  numbering,
  linkBase,
  onNavigate,
}: Props) {
  const slot = useContext(DocToolsContext);
  const onClick = useCallback(
    (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[data-nav]') as HTMLAnchorElement | null;
      if (!a || e.metaKey || e.ctrlKey || e.button !== 0) return;
      e.preventDefault();
      onNavigate(a.dataset.nav!);
    },
    [onNavigate],
  );

  if (error && !file) {
    return (
      <div className="leaf-doc-state" role="status">
        <p className="leaf-doc-state-title">
          {error.code === 'not_found' ? 'File removed or not found' : 'Cannot open this file'}
        </p>
        <p className="leaf-doc-state-detail">{path}</p>
      </div>
    );
  }
  if (!file) return <Loading label={path.slice(path.lastIndexOf('/') + 1) || undefined} />;

  const found = viewers.forFile(file);
  const marp = found.id === 'markdown' && !!file.content && isMarp(file.content);
  // The reader sends a `marp: true` file here when it's shown as slides.
  const viewer = marp ? deck : found;
  const Rich = viewer.Rich;
  const viewerProps = {
    file,
    content: file.content,
    docPath: file.path,
    config,
    handlers,
    numbering,
    linkBase,
  };
  return (
    <div className="leaf-main-inner" onClick={onClick} data-viewer={viewer.id}>
      {viewer.stage && slot ? (
        <InlineStage viewer={viewer} props={viewerProps} slot={slot} />
      ) : viewer.source && slot && file.encoding === 'utf8' ? (
        <WithSource viewer={viewer} props={viewerProps} slot={slot} />
      ) : viewer.stage ? (
        <BlockFrame viewer={viewer} props={viewerProps} lang={viewer.id}>
          <Rich {...viewerProps} />
        </BlockFrame>
      ) : (
        <Rich {...viewerProps} />
      )}
    </div>
  );
}
