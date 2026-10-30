// A markdown file is a Marp deck when its frontmatter says `marp: true`, as Marp's
// own tools decide. Kept apart from the renderer so knowing costs nothing at startup.
export function isMarp(source: string): boolean {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  return !!m && /^marp:\s*true\s*$/m.test(m[1]!);
}
