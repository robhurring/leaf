import { describe, it, expect } from 'vitest';
import { svgElementToString } from '../src/stage/image.js';

describe('svgElementToString', () => {
  it('serializes an svg with an xmlns and explicit size', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 50');
    const out = svgElementToString(svg, { width: 100, height: 50 });
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="100"');
    expect(out).toContain('height="50"');
  });
});
