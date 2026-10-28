// RFC 4180-ish parser: quoted fields, doubled quotes, CRLF. Delimiter guessed
// from the header line when not given.
export type Table = { header: string[]; rows: string[][] };

export function guessDelimiter(firstLine: string): string {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: string): Table {
  const firstLine = text.slice(0, text.indexOf('\n') < 0 ? undefined : text.indexOf('\n'));
  const d = delimiter ?? guessDelimiter(firstLine);
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  const [header = [], ...rows] = records.filter((r) => r.length > 1 || (r[0] ?? '') !== '');
  return { header, rows };
}
