// Vim-style path shortening: folders collapse to their first letter, outermost first,
// only as far as needed for the path to fit. The file name is always whole.

const initial = (dir: string) => (dir.startsWith('.') ? dir.slice(0, 2) : dir.slice(0, 1));

export function shortenPath(path: string, fits: (s: string) => boolean): string {
  const parts = path.split('/');
  const name = parts.pop()!;
  let out = path;
  for (let i = 0; i < parts.length && !fits(out); i++) {
    parts[i] = initial(parts[i]!);
    out = [...parts, name].join('/');
  }
  return out;
}
