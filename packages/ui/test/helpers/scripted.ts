import type { Capabilities, ClientMessage, RootInfo, ServerMessage } from '@leaf/protocol';
import { createSource, type FunctionSource } from '../../src/source/createSource.js';

type Binary = { base64: string; mime: string };
type Opts = { root?: RootInfo; capabilities?: Capabilities };

/** A DocumentSource over an in-memory file map, recording everything the UI sends. */
export function scripted(
  files: Record<string, string | Binary>,
  rootOrOpts: RootInfo | Opts = { kind: 'dir', name: 'x' },
) {
  const opts: Opts = 'kind' in rootOrOpts ? { root: rootOrOpts } : rootOrOpts;
  const root = opts.root ?? { kind: 'dir', name: 'x' };
  const capabilities = opts.capabilities ?? { watch: true, write: false, collaborate: false };
  const sizeOf = (v: string | Binary) => (typeof v === 'string' ? v.length : v.base64.length);
  const sent: ClientMessage[] = [];
  const source: FunctionSource = createSource({
    handle(msg, emit) {
      sent.push(msg);
      switch (msg.type) {
        case 'hello':
          return emit({
            type: 'welcome',
            protocol: 1,
            root,
            config: {},
            capabilities,
            participant: { id: 'local', name: 'You' },
          });
        case 'list': {
          const dir = msg.path ?? '';
          const prefix = dir ? dir + '/' : '';
          const seen = new Set<string>();
          const entries = [];
          for (const p of Object.keys(files)) {
            if (!p.startsWith(prefix)) continue;
            const [head, ...tail] = p.slice(prefix.length).split('/');
            if (!head || seen.has(head)) continue;
            seen.add(head);
            entries.push(
              tail.length
                ? { path: prefix + head, name: head, kind: 'dir' as const, hasChildren: true }
                : { path: p, name: head, kind: 'file' as const, size: sizeOf(files[p]!), mtime: 1 },
            );
          }
          entries.sort((a, b) =>
            a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
          );
          return emit({ type: 'tree', path: dir, entries, inReplyTo: msg.id });
        }
        case 'read': {
          const content = files[msg.path];
          if (content === undefined)
            return emit({
              type: 'error',
              code: 'not_found',
              message: 'missing',
              path: msg.path,
              inReplyTo: msg.id,
            });
          if (typeof content !== 'string')
            return emit({
              type: 'file',
              path: msg.path,
              kind: 'image',
              mime: content.mime,
              encoding: 'base64',
              content: content.base64,
              url: '/raw/' + msg.path,
              size: content.base64.length,
              mtime: 1,
              inReplyTo: msg.id,
            });
          const md = msg.path.endsWith('.md');
          return emit({
            type: 'file',
            path: msg.path,
            kind: md ? 'markdown' : 'text',
            lang: md ? 'markdown' : 'text',
            mime: md ? 'text/markdown' : 'text/plain',
            encoding: 'utf8',
            content,
            url: '/raw/' + msg.path,
            size: content.length,
            mtime: 1,
            inReplyTo: msg.id,
          });
        }
        case 'search': {
          const q = msg.q.toLowerCase();
          const entries = Object.keys(files)
            .filter((p) => p.toLowerCase().includes(q))
            .map((p) => ({ path: p, name: p.split('/').pop()!, kind: 'file' as const }));
          return emit({ type: 'matches', q: msg.q, entries, inReplyTo: msg.id });
        }
        case 'searchText': {
          const q = msg.q.toLowerCase();
          const hits = Object.entries(files).flatMap(([path, body]) =>
            (typeof body === 'string' ? body : '')
              .split('\n')
              .map((text, i) => ({ path, line: i + 1, text: text.trim() }))
              .filter((h) => h.text.toLowerCase().includes(q)),
          );
          return emit({ type: 'textMatches', q: msg.q, hits, inReplyTo: msg.id });
        }
        default:
          return;
      }
    },
  });
  return { source, sent, emit: (m: ServerMessage) => source.push(m), files };
}

export const README =
  '# Title\n\nIntro with a [guide](./docs/guide.md) link.\n\n## Setup\n\nFirst.\n\n## Setup\n\nSecond.\n\n### Deeper\n\nText.\n';
export const GUIDE = '# Guide\n\nGuide body.\n';
