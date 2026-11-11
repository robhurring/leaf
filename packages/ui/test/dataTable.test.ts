import { describe, expect, it } from 'vitest';
import { cellParts, cellText, compareCells } from '../src/render/cells.js';

describe('DataTable cells', () => {
  it('splits markdown links and bare urls out of a cell', () => {
    expect(cellParts('see [Wowhead](https://www.wowhead.com/forever/item=1) now')).toEqual([
      { text: 'see ' },
      { text: 'Wowhead', href: 'https://www.wowhead.com/forever/item=1' },
      { text: ' now' },
    ]);
    expect(cellParts('https://example.com/a?b=1')).toEqual([
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
    ]);
    expect(cellParts('plain')).toEqual([{ text: 'plain' }]);
  });

  it('sorts and filters by the visible text, not the url', () => {
    expect(cellText('[10](https://x/9)')).toBe('10');
    expect(compareCells('[10](https://x/9)', '[9](https://x/10)')).toBeGreaterThan(0);
  });
});
