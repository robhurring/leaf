import { describe, it, expect, vi } from 'vitest';
import { registerCommands, runCommand, COMMANDS } from '../src/commands.js';

describe('command registry', () => {
  it('runs a registered command by name, with its argument', () => {
    const toggleOutline = vi.fn();
    const setAppearance = vi.fn();
    const off = registerCommands({ toggleOutline, setAppearance });
    expect(runCommand('toggleOutline')).toBe(true);
    expect(runCommand('setAppearance', 'dark')).toBe(true);
    expect(toggleOutline).toHaveBeenCalledTimes(1);
    expect(setAppearance).toHaveBeenCalledWith('dark');
    expect(runCommand('nope')).toBe(false);
    off();
    expect(runCommand('toggleOutline')).toBe(false);
  });

  it('names the commands native menus may send', () => {
    for (const n of [
      'toggleTree',
      'toggleOutline',
      'toggleNumbering',
      'setAppearance',
      'textLarger',
      'textSmaller',
      'textReset',
      'openPalette',
      'openFiles',
      'openFind',
    ])
      expect(COMMANDS).toContain(n);
  });
});
