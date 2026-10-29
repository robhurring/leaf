// markdown string + registries → React element. Pure: no store, no network.
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkGemoji from 'remark-gemoji';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import { Fragment as JsxFragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Root } from 'hast';
import { VFile } from 'vfile';
import type { Config } from '@leaf/protocol';
import type { Handlers } from './handlers.js';
import { extractHeadings, type Heading } from './headings.js';
import { registries as defaultRegistries, type Registries } from './registries/index.js';
import { remarkAlerts } from './plugins/remarkAlerts.js';
import { remarkFrontmatterData } from './plugins/remarkFrontmatterData.js';
import { rehypeCodeBlocks } from './plugins/rehypeCodeBlocks.js';
import { rehypeHeadings } from './plugins/rehypeHeadings.js';
import { rehypeInline, type NodeSlots } from './plugins/rehypeInline.js';
import { rehypePos } from './plugins/rehypePos.js';
import { rehypeMathPending } from './plugins/rehypeMathPending.js';
import { track } from './progress.js';
import { load } from './connection.js';
import { CodeBlock } from './components/CodeBlock.js';
import { heading } from './components/Heading.js';
import { image } from './components/Image.js';
import { link } from './components/Link.js';

export type RenderOptions = {
  docPath: string;
  config: Config;
  handlers?: Handlers;
  registries?: Partial<Registries>;
  /** URL prefix for in-app navigation links (a site under /repo/ passes '/repo'). */
  linkBase?: string;
  /** Component overrides by tag (`leaf-code`, `pre`, …); the app injects framed blocks here. */
  components?: Partial<Components>;
  /** Syntax-highlight code blocks (default true). False renders plain code without waiting. */
  highlight?: boolean;
  /** Typeset math (default true). False shows each formula as a loading placeholder. */
  math?: boolean;
};

export type { Components };
export type Rendered = {
  element: ReactElement;
  headings: Heading[];
  frontmatter?: Record<string, unknown>;
};

export { extractHeadings };
export type { Heading, Handlers };

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), 'className', 'dataAlert'],
    p: [...(defaultSchema.attributes?.p ?? []), 'className'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
  },
};

export async function renderMarkdown(src: string, opts: RenderOptions): Promise<Rendered> {
  const reg = { ...defaultRegistries, ...opts.registries };
  let headings: Heading[] = [];
  const slots: NodeSlots = [];
  const ctx = { docPath: opts.docPath, config: opts.config, handlers: opts.handlers };

  // Heavy plugins load only for documents that need them: raw HTML (parse5) and math (KaTeX).
  const needsHtml = /<[A-Za-z!/]/.test(src);
  const needsMath = src.includes('$') && opts.math !== false;
  const [raw, katex] = await Promise.all([
    needsHtml ? track(load(() => import('rehype-raw'))) : null,
    needsMath
      ? track(load(() => Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')])))
      : null,
  ]);

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkFrontmatterData)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkGemoji)
    .use(remarkAlerts);
  for (const e of reg.parsers.all('remark')) processor.use(e.plugin as never, e.options as never);
  processor.use(remarkRehype, { allowDangerousHtml: true });
  if (raw) processor.use(raw.default);
  processor.use(rehypeSanitize, schema);
  if (katex) processor.use(katex[0].default);
  else if (opts.math === false) processor.use(rehypeMathPending);
  processor
    .use(rehypePos)
    .use(rehypeHeadings((h) => (headings = h)))
    .use(
      rehypeCodeBlocks({
        handlers: opts.handlers,
        blocks: reg.blocks,
        ctx: { docPath: opts.docPath, config: opts.config },
        slots,
        highlight: opts.highlight !== false,
      }),
    )
    .use(rehypeInline(reg.inline.all(), ctx, slots));
  for (const e of reg.parsers.all('rehype')) processor.use(e.plugin as never, e.options as never);

  const file = new VFile({ value: src });
  const tree = (await processor.run(processor.parse(file), file)) as Root;
  const frontmatter = file.data.frontmatter as Record<string, unknown> | undefined;

  const components: Components = {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    a: link({ docPath: opts.docPath, handlers: opts.handlers, linkBase: opts.linkBase ?? '' }),
    img: image(opts.docPath),
    'leaf-code': CodeBlock as never,
    ...opts.components,
    'leaf-node': ((props: { 'data-slot': string }) =>
      createElement(Fragment, null, slots[Number(props['data-slot'])] as ReactNode)) as never,
  };
  const element = toJsxRuntime(tree, {
    Fragment: JsxFragment,
    jsx,
    jsxs,
    components,
    passNode: false,
  });
  return { element, headings, frontmatter };
}
