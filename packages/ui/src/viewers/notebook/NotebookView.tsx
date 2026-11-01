// A Jupyter notebook, read like a document: markdown cells as markdown, code cells
// highlighted with their [count], and each output in its richest form. Code can be
// hidden to read it as a report; any cell's output collapses. HTML outputs (a pandas
// table, a widget's markup) run sealed off like a live pane: scripts, no network.
// There's no kernel: outputs are the ones saved in the notebook.
import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlockToolsContext } from '../../components/BlockFrame.js';
import { DocToolsContext } from '../../components/Properties.js';
import { Code } from '../../icons/index.js';
import type { ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { Markdown } from '../../components/Markdown.js';
import { SourceView } from '../../components/SourceView.js';
import { contentHash } from '../hash.js';
import { useDocuments } from '../../store/documents.js';
import { useDataFile } from '../../data/useDataFile.js';
import { FRAME_CSP } from '../live/frame.js';
import { parseNotebook, type Cell, type Output } from './parse.js';

/** An HTML output in a sandboxed frame that tells us its height. */
// Only loaded for a shared document, where HTML outputs wait for a click.
const RunGate = lazy(() => import('../../share/RunGate.js'));

function HtmlOutput({ html, gateKey }: { html: string; gateKey: string }) {
  const shared = useDocuments((s) => s.share !== null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(60);
  const srcdoc = useMemo(
    () =>
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
      '<style>html,body{margin:0;background:transparent;color-scheme:normal;font:13px/1.5 system-ui,sans-serif}' +
      'table{border-collapse:collapse}th,td{padding:4px 10px;border-bottom:1px solid rgba(127,127,127,.25);text-align:right}</style>' +
      `</head><body>${html}<script>new ResizeObserver(function(){parent.postMessage({leaf:'nb-html',h:document.documentElement.scrollHeight},'*')}).observe(document.documentElement)</script></body></html>`,
    [html],
  );
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { leaf?: string; h?: unknown };
      if (d?.leaf === 'nb-html' && typeof d.h === 'number' && d.h > 0)
        setHeight(Math.min(2000, Math.ceil(d.h) + 2));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const iframe = (
    <iframe
      ref={frame}
      className="leaf-nb-html"
      title="Output"
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      style={{ height }}
    />
  );
  if (!shared) return iframe;
  return (
    <Suspense fallback={null}>
      <RunGate label="Output" gateKey={gateKey} height={height}>
        {iframe}
      </RunGate>
    </Suspense>
  );
}

function OutputView({ out, docPath, gateKey }: { out: Output; docPath: string; gateKey: string }) {
  switch (out.kind) {
    case 'stream':
      return <pre className={`leaf-nb-stream leaf-nb-${out.name}`}>{out.text}</pre>;
    case 'text':
      return <pre className="leaf-nb-text">{out.text}</pre>;
    case 'image':
      return <img className="leaf-nb-image" src={out.src} alt="Output" />;
    case 'html':
      return <HtmlOutput html={out.html} gateKey={`${gateKey}:${contentHash(out.html)}`} />;
    case 'markdown':
      return <Markdown source={out.text} docPath={docPath} />;
    case 'error':
      return (
        <div className="leaf-nb-error" role="alert">
          <pre>{out.traceback || `${out.name}: ${out.value}`}</pre>
        </div>
      );
  }
}

function CellView(props: {
  cell: Cell;
  index: number;
  /** Tells this fence's cells from another's in the same document. */
  scope: string;
  language: string;
  showCode: boolean;
  docPath: string;
}) {
  const { cell, index, scope, language, showCode, docPath } = props;
  const [collapsed, setCollapsed] = useState(false);
  if (cell.type === 'markdown')
    return (
      <div className="leaf-nb-cell leaf-nb-md">
        <Markdown source={cell.source} docPath={docPath} />
      </div>
    );
  if (cell.type === 'raw')
    return (
      <div className="leaf-nb-cell">
        <pre className="leaf-nb-text">{cell.source}</pre>
      </div>
    );
  const count = cell.count == null ? ' ' : String(cell.count);
  return (
    <div className="leaf-nb-cell leaf-nb-codecell">
      {showCode && (
        <div className="leaf-nb-row">
          <span className="leaf-nb-prompt">[{count}]</span>
          <div className="leaf-nb-code">
            <SourceView code={cell.source} lang={language} />
          </div>
        </div>
      )}
      {cell.outputs.length > 0 && (
        <div className="leaf-nb-row">
          <button
            type="button"
            className="leaf-nb-prompt leaf-nb-fold"
            aria-label={collapsed ? 'Expand output' : 'Collapse output'}
            title={collapsed ? 'Expand output' : 'Collapse output'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {showCode ? '' : `[${count}]`}
            <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          </button>
          <div className="leaf-nb-outputs">
            {collapsed ? (
              <span className="leaf-nb-folded">
                {cell.outputs.length} output{cell.outputs.length === 1 ? '' : 's'} hidden
              </span>
            ) : (
              cell.outputs.map((o, i) => (
                <OutputView key={i} out={o} docPath={docPath} gateKey={`${scope}:${index}:${i}`} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotebookView(props: ViewerProps) {
  const code = props.content ?? '';
  // A fence holds the notebook's JSON, or names a file: `from: ./analysis.ipynb`.
  const from = code.trim().startsWith('{') ? undefined : /^\s*from:\s*(\S+)/m.exec(code)?.[1];
  const file = useDataFile(props.docPath, from);
  const text = from ? file.text : code;
  const parsed = useMemo(() => {
    if (from && file.error) return { error: file.error };
    if (text === undefined) return null;
    try {
      return { nb: parseNotebook(text) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, from, file.error]);
  const [showCode, setShowCode] = useState(true);
  const blockTools = useContext(BlockToolsContext);
  const docTools = useContext(DocToolsContext);
  const docPath = from ? file.path : props.docPath;

  if (!parsed) return <div className="leaf-diagram leaf-diagram-pending" aria-busy="true" />;
  if ('error' in parsed) return <DiagramError kind="notebook" message={parsed.error ?? ''} />;
  const { nb } = parsed;
  // Hide code sits with the other tools: the block's hover toolbar, or the file toolbar.
  const button = (
    <button
      type="button"
      className="leaf-tool"
      aria-label={showCode ? 'Hide code' : 'Show code'}
      title={showCode ? 'Hide the code, read it as a report' : 'Show the code'}
      aria-pressed={!showCode}
      onClick={() => setShowCode((v) => !v)}
    >
      <Code size={15} />
    </button>
  );
  const target = blockTools ?? docTools;
  // In a document it's a card of its own that scrolls.
  const embedded = !!blockTools && !docTools;
  const toggle = target ? (
    createPortal(button, target)
  ) : (
    <div className="leaf-nb-bar">{button}</div>
  );
  return (
    <div className="leaf-nb" data-language={nb.language} data-embedded={embedded ? '' : undefined}>
      {toggle}
      {nb.cells.map((cell, i) => (
        <CellView
          key={i}
          cell={cell}
          index={i}
          scope={`${docPath}:${contentHash(text ?? '')}`}
          language={nb.language}
          showCode={showCode}
          docPath={docPath}
        />
      ))}
    </div>
  );
}
