import { describe, it, expect } from 'vitest';
import {
  FRAME_CSP,
  buildSrcdoc,
  isFromFrame,
  paneHeight,
  type Boot,
} from '../src/viewers/live/frame.js';

const boot = (over: Partial<Boot> = {}): Boot => ({
  kind: 'canvas',
  code: 'onFrame(() => {});',
  theme: 'light',
  paused: false,
  ...over,
});
const HARNESS = 'function (win) { win.harnessRan = true; }';
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('live pane frame', () => {
  it('pane height is 320 unless the fence says otherwise, clamped to 120–1200', () => {
    expect(paneHeight(undefined)).toBe(320);
    expect(paneHeight('')).toBe(320);
    expect(paneHeight('height=480')).toBe(480);
    expect(paneHeight('height=50')).toBe(120);
    expect(paneHeight('height=5000')).toBe(1200);
    expect(paneHeight('height=abc foo')).toBe(320);
  });

  it('the policy that blocks the network comes before any script', () => {
    expect(FRAME_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:",
    );
    const html = buildSrcdoc(boot(), HARNESS);
    const meta = html.indexOf(`<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`);
    expect(meta).toBeGreaterThan(-1);
    expect(meta).toBeLessThan(html.indexOf('<script'));
  });

  it('the frame knows the theme', () => {
    expect(parse(buildSrcdoc(boot({ theme: 'dark' }), HARNESS)).documentElement.dataset.theme).toBe(
      'dark',
    );
  });

  it('the library runs before the harness, and cannot end its script early', () => {
    const html = buildSrcdoc(
      boot({ kind: 'three', libs: { three: 'window.X = "</script>";' } }),
      HARNESS,
    );
    const lib = html.indexOf('window.X');
    const harness = html.indexOf(HARNESS);
    expect(lib).toBeGreaterThan(-1);
    expect(lib).toBeLessThan(harness);
    const libEnd = html.indexOf('</script>', lib);
    expect(html.slice(lib, libEnd)).not.toMatch(/<\/script/i);
    expect(html.slice(lib, libEnd)).toContain('<\\/script>');
    // The library is not also copied into the boot data.
    expect(html.indexOf('window.X')).toBe(html.lastIndexOf('window.X'));
  });

  it('block code with </script> and <!-- comes back exactly, without breaking out', () => {
    const code = 'const s = "</script><!--";\n// \u2028 done';
    const html = buildSrcdoc(boot({ code }), HARNESS);
    const doc = parse(html);
    const el = doc.getElementById('leaf-boot')!;
    expect(el.getAttribute('type')).toBe('application/json');
    expect(JSON.parse(el.textContent!).code).toBe(code);
    const start = html.indexOf('id="leaf-boot"');
    expect(html.slice(start, html.indexOf('</script>', start))).not.toContain('<');
  });

  it('the harness is called with the window', () => {
    expect(buildSrcdoc(boot(), HARNESS)).toContain(`<script>(${HARNESS})(window)</script>`);
  });

  it('accepts only well-formed messages from a pane', () => {
    expect(isFromFrame({ leaf: 'live', type: 'ready' })).toBe(true);
    expect(isFromFrame({ leaf: 'live', type: 'error', message: 'x', line: 2 })).toBe(true);
    expect(isFromFrame({ type: 'ready' })).toBe(false);
    expect(isFromFrame(null)).toBe(false);
    expect(isFromFrame('ready')).toBe(false);
    expect(isFromFrame({ leaf: 'live', type: 'error' })).toBe(false);
    expect(isFromFrame({ leaf: 'live', type: 'nope' })).toBe(false);
    expect(
      isFromFrame({ leaf: 'live', type: 'snapshot', id: 1, url: 'data:image/png;base64,AA' }),
    ).toBe(true);
    // Only a PNG of the picture, never a link somewhere.
    expect(isFromFrame({ leaf: 'live', type: 'snapshot', id: 1, url: 'https://x/y.png' })).toBe(
      false,
    );
  });
});
