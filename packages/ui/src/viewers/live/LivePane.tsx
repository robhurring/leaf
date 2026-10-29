// A live animation pane: a three or canvas block running in a sandboxed frame. It runs
// only while it is on screen, the window is showing, it isn't paused, and the same
// block isn't open in the Stage; errors show under it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ViewerProps } from '../types.js';
import { DiagramError } from '../diagramError.js';
import { contentHash } from '../hash.js';
import { useAppearance } from '../appearance.js';
import { useStage } from '../../store/stage.js';
import { Code, Pause, Play, Restart } from '../../icons/index.js';
import {
  buildSrcdoc,
  isFromFrame,
  paneHeight,
  type Libs,
  type LiveKind,
  type ToFrame,
} from './frame.js';
import { harness } from './harness.js';
import { loadThreeLibs } from './libs.js';

const HARNESS = harness.toString();

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The fence language, which the block bridge puts after the `#` in the file path. */
const kindOf = (path: string): LiveKind => (path.endsWith('#three') ? 'three' : 'canvas');

type Failure = { message: string; line?: number };

export function LivePane(props: ViewerProps & { fill?: boolean }) {
  const { file, docPath, fill } = props;
  const code = props.content ?? '';
  const kind = kindOf(file.path);
  const hash = contentHash(code);
  const theme = useAppearance(props.appearance);

  const frame = useRef<HTMLIFrameElement>(null);
  const [userPaused, setUserPaused] = useState(prefersReducedMotion);
  const [inView, setInView] = useState(typeof IntersectionObserver === 'undefined');
  const [hidden, setHidden] = useState(() => document.hidden);
  const [showCode, setShowCode] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [libs, setLibs] = useState<Libs | null | undefined>(kind === 'three' ? undefined : null);
  const host = useRef<HTMLDivElement>(null);
  // The inline pane rests while its block is shown large in the Stage.
  const inStage = useStage(
    (s) => !fill && !!s.open && s.open.docPath === docPath && s.open.blockHash === hash,
  );
  const running = inView && !hidden && !userPaused && !inStage && !showCode;

  useEffect(() => {
    if (kind !== 'three') return;
    let live = true;
    loadThreeLibs().then(
      (l) => live && setLibs(l),
      (e: unknown) => live && setFailure({ message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [kind]);

  // The frame's document changes only with the block's code; theme and running state
  // are sent to it as messages.
  const startPaused = useRef(!running);
  startPaused.current = !running;
  const startTheme = useRef(theme);
  startTheme.current = theme;
  const srcdoc = useMemo(
    () =>
      libs === undefined
        ? null
        : buildSrcdoc(
            {
              kind,
              code,
              theme: startTheme.current,
              paused: startPaused.current,
              libs: libs ?? undefined,
            },
            HARNESS,
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, hash, libs],
  );

  const send = (msg: ToFrame) => frame.current?.contentWindow?.postMessage(msg, '*');

  useEffect(() => {
    setReady(false);
    setLoaded(false);
    setFailure(null);
  }, [srcdoc, generation]);

  useEffect(() => {
    if (loaded) send({ leaf: 'live', type: running ? 'play' : 'pause' });
  }, [loaded, running]);

  useEffect(() => {
    if (loaded) send({ leaf: 'live', type: 'theme', theme });
  }, [loaded, theme]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      if (!isFromFrame(e.data)) return;
      if (e.data.type === 'ready') setReady(true);
      else setFailure({ message: e.data.message, line: e.data.line });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setInView(e.isIntersecting);
    });
    io.observe(host.current);
    return () => io.disconnect();
  }, []);

  const state = failure ? 'error' : !ready ? 'loading' : running ? 'running' : 'paused';
  const height = fill ? undefined : paneHeight(props.meta);

  return (
    <div
      ref={host}
      className="leaf-live"
      data-state={state}
      data-kind={kind}
      data-fill={fill ? '' : undefined}
    >
      <div className="leaf-live-view" style={height ? { height } : undefined}>
        {showCode ? (
          <pre className="leaf-live-source">
            <code>{code}</code>
          </pre>
        ) : (
          srcdoc !== null && (
            <iframe
              key={generation}
              ref={frame}
              title={`${kind} animation`}
              sandbox="allow-scripts"
              srcDoc={srcdoc}
              style={height ? { height } : undefined}
              onLoad={() => setLoaded(true)}
            />
          )
        )}
        <div className="leaf-live-controls" role="group" aria-label="Animation">
          <button
            type="button"
            className="leaf-tool"
            aria-label={userPaused ? 'Play' : 'Pause'}
            title={userPaused ? 'Play' : 'Pause'}
            onClick={() => setUserPaused((p) => !p)}
          >
            {userPaused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            type="button"
            className="leaf-tool"
            aria-label="Restart"
            title="Restart"
            onClick={() => {
              setShowCode(false);
              setGeneration((g) => g + 1);
            }}
          >
            <Restart size={15} />
          </button>
          <button
            type="button"
            className="leaf-tool"
            aria-label="View code"
            title="View code"
            aria-pressed={showCode}
            onClick={() => setShowCode((s) => !s)}
          >
            <Code size={15} />
          </button>
        </div>
      </div>
      {failure && (
        <DiagramError
          kind={kind}
          message={failure.line ? `line ${failure.line}: ${failure.message}` : failure.message}
        />
      )}
    </div>
  );
}
