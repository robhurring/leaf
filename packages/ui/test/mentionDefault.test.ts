import { describe, it, expect } from 'vitest';
import { mentionUrlFor } from '../src/render/inline/mention.js';

describe('mentionUrlFor', () => {
  it('derives a profile template from a known forge host, else nothing', () => {
    expect(mentionUrlFor('https://github.com/rob/leaf')).toBe('https://github.com/{username}');
    expect(mentionUrlFor('https://gitlab.com/team/leaf')).toBe('https://gitlab.com/{username}');
    expect(mentionUrlFor('https://git.example.com/team/leaf')).toBeUndefined();
    expect(mentionUrlFor(undefined)).toBeUndefined();
  });
});
