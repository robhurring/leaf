// Colors for data with no colors of its own (chart datasets, map categories),
// readable on leaf's light and dark pages.
export const PALETTE = [
  '#3e82f7',
  '#30a46c',
  '#d29922',
  '#e5484d',
  '#8e4ec6',
  '#12a594',
  '#e54666',
  '#f76b15',
];

export const paletteAt = (i: number) => PALETTE[i % PALETTE.length]!;

/** Text and rule colors for drawing on leaf's page in each appearance. */
export const INK = {
  light: { text: '#1f2328', muted: '#59636e', rule: 'rgba(31,35,40,0.12)', land: '#e6e9ed' },
  dark: { text: '#e6edf3', muted: '#9198a1', rule: 'rgba(230,237,243,0.14)', land: '#2a3038' },
};
