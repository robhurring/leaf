// Turning a rendered diagram into something you can paste or save.
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
  const text = svgElementToString(svg, size);
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
