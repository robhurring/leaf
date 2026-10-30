// A Jupyter notebook (nbformat 4) read into cells, each output kept in its richest form.
export type Output =
  | { kind: 'stream'; name: string; text: string }
  | { kind: 'image'; mime: string; src: string }
  | { kind: 'html'; html: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'error'; name: string; value: string; traceback: string };

export type Cell = {
  type: 'markdown' | 'code' | 'raw';
  source: string;
  count?: number | null;
  outputs: Output[];
};

export type Notebook = { language: string; cells: Cell[] };

type Multiline = string | string[] | undefined;
const join = (s: Multiline) => (Array.isArray(s) ? s.join('') : (s ?? ''));
// Terminal colors in tracebacks: ESC [ ... m.
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

function richest(data: Record<string, Multiline>): Output | null {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif']) {
    const b64 = data[mime];
    if (b64)
      return { kind: 'image', mime, src: `data:${mime};base64,${join(b64).replace(/\s/g, '')}` };
  }
  if (data['image/svg+xml'])
    return {
      kind: 'image',
      mime: 'image/svg+xml',
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(join(data['image/svg+xml']))}`,
    };
  if (data['text/html']) return { kind: 'html', html: join(data['text/html']) };
  if (data['text/markdown']) return { kind: 'markdown', text: join(data['text/markdown']) };
  if (data['text/latex']) return { kind: 'markdown', text: join(data['text/latex']) };
  if (data['application/json'])
    return { kind: 'text', text: JSON.stringify(data['application/json'], null, 2) };
  if (data['text/plain']) return { kind: 'text', text: join(data['text/plain']) };
  return null;
}

function output(o: Record<string, unknown>): Output | null {
  switch (o.output_type) {
    case 'stream':
      return { kind: 'stream', name: String(o.name ?? 'stdout'), text: join(o.text as Multiline) };
    case 'error':
      return {
        kind: 'error',
        name: String(o.ename ?? 'Error'),
        value: String(o.evalue ?? ''),
        traceback: stripAnsi(((o.traceback as string[]) ?? []).join('\n')),
      };
    case 'execute_result':
    case 'display_data':
      return richest((o.data ?? {}) as Record<string, Multiline>);
    default:
      return null;
  }
}

export function parseNotebook(text: string): Notebook {
  const raw = JSON.parse(text) as {
    cells?: unknown;
    metadata?: { kernelspec?: { language?: string }; language_info?: { name?: string } };
  };
  if (!raw || !Array.isArray(raw.cells))
    throw new Error('Not a Jupyter notebook: expected a "cells" list (nbformat 4).');
  const language =
    raw.metadata?.language_info?.name ?? raw.metadata?.kernelspec?.language ?? 'python';
  const cells = (raw.cells as Record<string, unknown>[]).map((c): Cell => {
    const type = c.cell_type === 'markdown' || c.cell_type === 'code' ? c.cell_type : 'raw';
    return {
      type,
      source: join(c.source as Multiline),
      count: type === 'code' ? ((c.execution_count as number | null) ?? null) : undefined,
      outputs: ((c.outputs as Record<string, unknown>[]) ?? []).flatMap((o) => {
        const out = output(o);
        return out ? [out] : [];
      }),
    };
  });
  return { language, cells };
}
