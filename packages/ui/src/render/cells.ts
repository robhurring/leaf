// What a table cell says and how two cells compare, shared by the csv table and sortable
// markdown tables.
const num = (s: string) => {
  const n = Number(s.replace(/[,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

// A cell is text, with markdown links `[text](url)` and bare http(s) URLs rendered as links.
const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/g;

export type CellPart = { text: string; href?: string };

export function cellParts(s: string): CellPart[] {
  const parts: CellPart[] = [];
  let last = 0;
  for (const m of s.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: s.slice(last, at) });
    parts.push(m[2] ? { text: m[1], href: m[2] } : { text: m[3], href: m[3] });
    last = at + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

/** The cell's visible text: link labels without their URLs, so sorting and filtering see what the reader sees. */
export function cellText(s: string): string {
  return cellParts(s)
    .map((p) => p.text)
    .join('');
}

export function compareCells(a: string, b: string): number {
  const ta = cellText(a);
  const tb = cellText(b);
  const na = num(ta);
  const nb = num(tb);
  if (na !== null && nb !== null) return na - nb;
  return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: 'base' });
}
