import { describe, it, expect } from 'vitest';
import { createInlineRegistry } from '../src/render/registries/inline.js';

describe('inline registry', () => {
  it('registers and lists matchers in order', () => {
    const reg = createInlineRegistry();
    reg.register({
      name: 'ticket',
      pattern: /\b([A-Z]+-\d+)\b/g,
      render: (m) => ({ href: `https://t/${m[1]}` }),
    });
    expect(reg.all().map((m) => m.name)).toEqual(['mention', 'topic', 'ticket']);
  });

  it('a matcher can be replaced by name', () => {
    const reg = createInlineRegistry();
    reg.register({ name: 'mention', pattern: /@(\w+)/g, render: () => null });
    expect(reg.all().filter((m) => m.name === 'mention')).toHaveLength(1);
  });
});
