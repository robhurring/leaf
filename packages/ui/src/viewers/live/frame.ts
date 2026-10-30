// The document inside a live pane's sandboxed frame: a policy that blocks the
// network, the block's code as JSON data, the bundled library (three only), and the
// harness that runs it all. The frame has no origin of its own, so everything it
// needs is written into it here.

export type LiveKind = 'three' | 'canvas';
export type Theme = 'light' | 'dark';
/** One classic script that sets window.THREE and window.OrbitControls. */
export type Libs = { three: string };
export type Boot = { kind: LiveKind; code: string; theme: Theme; paused: boolean; libs?: Libs };

export type ToFrame =
  | { leaf: 'live'; type: 'play' | 'pause' | 'restart' }
  | { leaf: 'live'; type: 'snapshot'; id: number }
  | { leaf: 'live'; type: 'theme'; theme: Theme };
export type FromFrame =
  | { leaf: 'live'; type: 'ready' }
  | { leaf: 'live'; type: 'error'; message: string; line?: number }
  | { leaf: 'live'; type: 'snapshot'; id: number; url: string };

export const FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";

const HEIGHT = { default: 320, min: 120, max: 1200 };

/** The pane's height from the fence's info string: `height=480`. */
export function paneHeight(meta: string | undefined): number {
  const m = /(?:^|\s)height=(\d+)(?:\s|$)/.exec(meta ?? '');
  if (!m) return HEIGHT.default;
  return Math.min(HEIGHT.max, Math.max(HEIGHT.min, Number(m[1])));
}

/** JSON that can sit inside a <script> element: no `<` and no line separators. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Script text that cannot close its element or open an HTML comment. */
function scriptText(js: string): string {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

export function buildSrcdoc(boot: Boot, harnessSource: string): string {
  const { libs, ...data } = boot;
  return [
    `<!doctype html><html data-theme="${boot.theme}"><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    '<meta charset="utf-8">',
    // Transparent, so the pane sits on whatever page leaf is showing.
    '<style>html{color-scheme:normal}html,body{margin:0;height:100%;overflow:hidden;background:transparent}</style>',
    '</head><body>',
    `<script type="application/json" id="leaf-boot">${scriptJson(data)}</script>`,
    libs ? `<script>${scriptText(libs.three)}</script>` : '',
    `<script>(${scriptText(harnessSource)})(window)</script>`,
    '</body></html>',
  ].join('');
}

export function isFromFrame(data: unknown): data is FromFrame {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.leaf !== 'live') return false;
  if (d.type === 'ready') return true;
  if (d.type === 'snapshot')
    return (
      typeof d.id === 'number' &&
      typeof d.url === 'string' &&
      d.url.startsWith('data:image/png;base64,')
    );
  return d.type === 'error' && typeof d.message === 'string';
}
