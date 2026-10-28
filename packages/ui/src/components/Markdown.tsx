// Renders one markdown document through the engine. Standalone: no store, no
// source; hosts can embed it in their own layout.
import { useEffect, useState, type ReactElement } from 'react';
import type { Config } from '@leaf/protocol';
import { NumberingContext } from '../render/components/Heading.js';
import { RenderError } from './ErrorBoundary.js';
import { FramedCodeBlock } from './FramedCodeBlock.js';

const APP_COMPONENTS = { 'leaf-code': FramedCodeBlock as never };
import type { Handlers } from '../render/handlers.js';
import { renderMarkdown, type Heading } from '../render/pipeline.js';
import { Loading } from './Loading.js';
import type { Registries } from '../render/registries/index.js';

export type MarkdownProps = {
  source: string;
  docPath?: string;
  config?: Config;
  handlers?: Handlers;
  registries?: Partial<Registries>;
  numbering?: boolean;
  linkBase?: string;
  onRendered?(info: { headings: Heading[]; frontmatter?: Record<string, unknown> }): void;
};

export function Markdown(props: MarkdownProps) {
  const {
    source,
    docPath = 'document.md',
    config,
    handlers,
    registries,
    numbering = false,
    linkBase,
    onRendered,
  } = props;
  const [element, setElement] = useState<ReactElement | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    const opts = {
      docPath,
      config: config ?? {},
      handlers,
      registries,
      linkBase,
      components: APP_COMPONENTS,
    };
    const fail = (e: unknown) => {
      if (live) setError(e instanceof Error ? e : new Error(String(e)));
    };
    // Code blocks wait on the highlighter (a grammar can take a second to load), so a
    // document with fences shows first with plain code and its colors arrive after.
    // Math waits on KaTeX the same way; each formula shows a loader meanwhile.
    const hasFences = /^\s{0,3}(```|~~~)/m.test(source);
    const hasMath = source.includes('$');
    const twoPass = hasFences || hasMath;
    const first = renderMarkdown(source, { ...opts, highlight: !hasFences, math: !hasMath });
    first
      .then((r) => {
        if (!live) return;
        setError(null);
        setElement(r.element);
        onRendered?.({ headings: r.headings, frontmatter: r.frontmatter });
        if (!twoPass) return;
        // Let the plain document paint before the color pass starts work.
        return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
          .then(() => (live ? renderMarkdown(source, opts) : null))
          .then((full) => {
            if (live && full) setElement(full.element);
          });
      })
      .catch(fail);
    return () => {
      live = false;
    };
    // onRendered identity is not a reason to re-render the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, docPath, config, handlers, registries, linkBase]);
  return (
    <NumberingContext.Provider value={numbering}>
      <article className="leaf-doc">
        {error ? (
          <RenderError label="document" error={error} />
        ) : (
          (element ?? <Loading label={docPath.slice(docPath.lastIndexOf('/') + 1)} />)
        )}
      </article>
    </NumberingContext.Provider>
  );
}
