// Shiki highlighter, created once, languages loaded on demand. Both GitHub
// themes are emitted; CSS picks one by appearance.
import { track } from './progress.js';
import type { Element } from 'hast';
import { bundledLanguages, createHighlighter, type Highlighter } from 'shiki';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

let highlighterPromise: Promise<Highlighter> | undefined;
const loaded = new Set<string>(['text']);

function get(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [],
    // Oniguruma (WASM, as in VS Code): the JS regex engine takes a second per large
    // grammar on WebKit, which is the app window's engine.
    engine: createOnigurumaEngine(import('shiki/wasm')),
  });
  return highlighterPromise;
}

/** Starts loading the highlighter and its themes ahead of the first code block. */
export function warmHighlighter(): void {
  void get().catch(() => undefined);
}

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  dotenv: 'ini',
};

export async function resolveLang(lang: string): Promise<string> {
  const name = ALIASES[lang] ?? lang;
  if (loaded.has(name)) return name;
  if (!(name in bundledLanguages)) return 'text';
  const h = await get();
  await track(h.loadLanguage(name as keyof typeof bundledLanguages));
  loaded.add(name);
  return name;
}

/** The shiki <pre> element for `code`, or null when highlighting is unavailable. */
export async function highlightToHast(code: string, lang: string): Promise<Element | null> {
  try {
    const h = await get();
    const name = await resolveLang(lang);
    const root = h.codeToHast(code, {
      lang: name,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
    const pre = root.children.find((c) => c.type === 'element') as Element | undefined;
    return pre ?? null;
  } catch {
    return null;
  }
}
