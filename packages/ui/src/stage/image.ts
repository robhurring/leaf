// Turning a rendered diagram into something you can paste or save.
import type { Stroke } from '../store/annotations.js';
import { INK_COLORS } from '../store/stage.js';
export function svgElementToString(
  svg: SVGElement,
  size?: { width: number; height: number },
): string {
  const clone = svg.cloneNode(true) as SVGElement;
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (size) {
    clone.setAttribute('width', String(size.width));
    clone.setAttribute('height', String(size.height));
  }
  return new XMLSerializer().serializeToString(clone);
}

function sizeOf(svg: SVGElement): { width: number; height: number } {
  const rect = (svg as SVGGraphicsElement).getBoundingClientRect?.();
  const vb = svg
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  const width = rect?.width || Number(svg.getAttribute('width')) || vb?.[2] || 800;
  const height = rect?.height || Number(svg.getAttribute('height')) || vb?.[3] || 600;
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

/** Rasterizes an SVG at 2x for crisp pasting. */
export async function svgToPngBlob(svg: SVGElement, scale = 2): Promise<Blob> {
  const size = sizeOf(svg);
  return svgTextToPng(svgElementToString(svg, size), size, scale);
}

/** Rasterizes SVG markup of a known size, on white. */
export async function svgTextToPng(
  text: string,
  size: { width: number; height: number },
  scale = 2,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('could not rasterize the diagram'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size.width * scale;
    canvas.height = size.height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png encode failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Where the picture sits on the Stage's layer, in content pixels: an svg's markup or an image's href. */
export type PlacedPicture = { x: number; y: number; width: number; height: number } & (
  { markup: string } | { href: string }
);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The picture with its ink drawn over it, as one svg the size of the content. */
export function composeSvg(
  size: { w: number; h: number },
  picture: PlacedPicture | null,
  strokes: Stroke[],
  /** Where the view starts (a drawing cropped to its ink) and the color under it. */
  frame: { x: number; y: number; background?: string } = { x: 0, y: 0 },
): string {
  const { w, h } = size;
  const { x, y, background } = frame;
  let under = '';
  if (picture && 'markup' in picture) {
    // The diagram's own svg, nested and placed: its viewBox keeps its drawing in scale.
    const doc = new DOMParser().parseFromString(picture.markup, 'image/svg+xml');
    const svg = doc.documentElement;
    for (const [k, v] of Object.entries({
      x: picture.x,
      y: picture.y,
      width: picture.width,
      height: picture.height,
    }))
      svg.setAttribute(k, String(v));
    svg.removeAttribute('style');
    under = new XMLSerializer().serializeToString(svg);
  } else if (picture) {
    under = `<image href="${esc(picture.href)}" x="${picture.x}" y="${picture.y}" width="${picture.width}" height="${picture.height}"/>`;
  }
  const ink = strokes
    .map(
      (s) =>
        `<path d="${s.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ')}" fill="none" stroke="${INK_COLORS[s.color]}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  const bg = background
    ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(background)}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">${bg}${under}${ink}</svg>`;
}

/** The box around every stroke (each reaching half its width past its points), padded. */
export function inkBounds(strokes: Stroke[], pad = 16) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (const [x, y] of s.points) {
      const r = s.width / 2;
      x0 = Math.min(x0, x - r);
      y0 = Math.min(y0, y - r);
      x1 = Math.max(x1, x + r);
      y1 = Math.max(y1, y + r);
    }
  if (x0 === Infinity) return null;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

const dataUrlOf = async (src: string) => {
  const blob = await (await fetch(src)).blob();
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('could not read the image'));
    r.readAsDataURL(blob);
  });
};

/** The Stage's picture, placed in content pixels (the layer is scaled by `scale`). */
export async function placedPicture(
  layer: HTMLElement,
  scale: number,
): Promise<PlacedPicture | null> {
  const el = layer.querySelector<SVGSVGElement | HTMLImageElement>('svg:not(.leaf-draw), img');
  if (!el) return null;
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const box = {
    x: (r.left - lr.left) / scale,
    y: (r.top - lr.top) / scale,
    width: r.width / scale,
    height: r.height / scale,
  };
  if (el instanceof HTMLImageElement)
    return { ...box, href: await dataUrlOf(el.currentSrc || el.src) };
  const clone = el.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute('viewBox'))
    clone.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return { ...box, markup: new XMLSerializer().serializeToString(clone) };
}

/** Copies a rendered <img> (same-origin or CORS-enabled) as PNG. Tainted canvases throw. */
export async function copyRaster(img: HTMLImageElement): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png encode failed'))), 'image/png'),
  );
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** The clipboard write starts before the PNG exists: Safari and WebKit only honor a
 *  write made inside the click, and accept a promise for the bytes. */
export async function copyImage(svg: SVGElement): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPngBlob(svg) })]);
}

/** The page color behind `el`, so a copied picture keeps its background when pasted. */
function backdropOf(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return '#ffffff';
}

/** A canvas (a chart) as a PNG on the page's color. */
async function canvasToPng(source: CanvasImageSource, w: number, h: number, bg: string) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png encode failed'))), 'image/png'),
  );
}

export async function copyCanvas(canvas: HTMLCanvasElement): Promise<void> {
  const png = canvasToPng(canvas, canvas.width, canvas.height, backdropOf(canvas));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

let snapshots = 0;
/** A live pane's picture: its sandboxed frame sends a PNG when asked. */
function snapshotOf(frame: HTMLIFrameElement): Promise<Blob> {
  const id = ++snapshots;
  return new Promise<string>((resolve, reject) => {
    const done = setTimeout(() => {
      removeEventListener('message', onMessage);
      reject(new Error('no picture'));
    }, 2000);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { leaf?: string; type?: string; id?: number; url?: unknown };
      if (e.source !== frame.contentWindow || d?.leaf !== 'live' || d.type !== 'snapshot') return;
      if (d.id !== id || typeof d.url !== 'string' || !d.url.startsWith('data:image/png;base64,'))
        return;
      clearTimeout(done);
      removeEventListener('message', onMessage);
      resolve(d.url);
    };
    addEventListener('message', onMessage);
    frame.contentWindow?.postMessage({ leaf: 'live', type: 'snapshot', id }, '*');
  }).then(
    (url) =>
      new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.onload = () =>
          canvasToPng(img, img.naturalWidth, img.naturalHeight, backdropOf(frame)).then(
            resolve,
            reject,
          );
        img.onerror = () => reject(new Error('bad picture'));
        img.src = url;
      }),
  );
}

export async function copyFrame(frame: HTMLIFrameElement): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': snapshotOf(frame) })]);
}

export function downloadText(text: string, name: string, type = 'image/svg+xml'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
