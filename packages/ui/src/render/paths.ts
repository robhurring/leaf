// Path helpers for links and images inside a document.
export const isAbsoluteUrl = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

/** Resolves `rel` against the directory of `docPath`; never escapes above the root. */
export function resolveRelative(docPath: string, rel: string): string {
  const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')).split('/') : [];
  const parts = rel.startsWith('/') ? [] : [...dir];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.map(safeDecode).join('/');
}

/** decodeURIComponent that leaves malformed sequences (a literal `50%`) alone. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
