import { describe, it, expect } from 'vitest';
import { sizeToViewBox } from '../src/stage/measure.js';

const svg = (attrs: string) => {
  const host = document.createElement('div');
  host.innerHTML = `<svg ${attrs}></svg>`;
  return host.firstElementChild as SVGSVGElement;
};

describe('sizeToViewBox', () => {
  it('gives a percent-width svg its viewBox size so the Stage can fit it', () => {
    const el = svg('width="100%" viewBox="4 4 1930.35 393.5" style="max-width: 1930px"');
    sizeToViewBox(el);
    expect(el.style.width).toBe('1930.35px');
    expect(el.style.height).toBe('393.5px');
    expect(el.style.maxWidth).toBe('none');
  });

  it('leaves an svg with absolute dimensions alone', () => {
    const el = svg('width="200" height="80" viewBox="0 0 200 80"');
    sizeToViewBox(el);
    expect(el.style.width).toBe('');
  });

  it('ignores an svg without a viewBox', () => {
    const el = svg('width="100%"');
    sizeToViewBox(el);
    expect(el.style.width).toBe('');
  });
});

describe('contentSize', () => {
  it('reports nothing while a viewer is still busy, so fit waits for the picture', async () => {
    const { contentSize } = await import('../src/stage/measure.js');
    const layer = document.createElement('div');
    layer.innerHTML = '<div class="leaf-diagram leaf-diagram-pending" aria-busy="true"></div>';
    expect(contentSize(layer)).toBeNull();
    layer.innerHTML = '<div class="leaf-diagram"><svg viewBox="0 0 10 10"></svg></div>';
    const child = layer.firstElementChild as HTMLElement;
    Object.defineProperty(child, 'scrollWidth', { value: 120 });
    Object.defineProperty(child, 'scrollHeight', { value: 40 });
    expect(contentSize(layer)).toEqual({ w: 120, h: 40 });
  });
});
