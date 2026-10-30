import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GoTo, type GoToTab } from '../src/components/GoTo.js';
import type { Heading } from '../src/render/headings.js';

const headings: Heading[] = [
  { depth: 1, text: 'Setup', slug: 'setup', number: [1] } as unknown as Heading,
];
const files = [
  { name: 'a.md', path: 'a.md', kind: 'file' as const },
  { name: 'plan.md', path: 'notes/plan.md', kind: 'file' as const },
];
const tabs: GoToTab[] = [
  { id: 't2', label: '~/code/docs', doc: 'notes/plan.md', sameRoot: true },
  { id: 't3', label: '~/work/site', doc: 'index.md', sameRoot: false },
];

function setup(extra: Partial<Parameters<typeof GoTo>[0]> = {}) {
  const props = {
    mode: 'all' as const,
    headings,
    files,
    numbering: false,
    docRoot: () => null,
    onSearch: vi.fn(),
    hits: [],
    currentPath: 'a.md',
    onSearchText: vi.fn(),
    onOpenAt: vi.fn(),
    onJump: vi.fn(),
    onOpen: vi.fn(),
    onFind: vi.fn(),
    onClose: vi.fn(),
    tabs,
    onTab: vi.fn(),
    ...extra,
  };
  render(<GoTo {...props} />);
  return props;
}
const group = (name: string) => screen.queryByRole('group', { name });

describe('⌘K and tabs', () => {
  it('lists this window’s other tabs first, then the document’s headings', () => {
    setup();
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Tabs', 'Headings']);
    expect(within(group('Tabs')!).getAllByRole('option')).toHaveLength(2);
  });

  it('matches a tab by its name or the document it shows', () => {
    setup();
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'site' } });
    expect(within(group('Tabs')!).getAllByRole('option')).toHaveLength(1);
    fireEvent.change(box, { target: { value: 'plan' } });
    expect(within(group('Tabs')!).getByRole('option').textContent).toContain('~/code/docs');
  });

  it('a file open in another tab shows once, under Tabs, marked open', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'plan' } });
    expect(within(group('Tabs')!).getByRole('option').textContent).toContain('open');
    expect(group('Files')).toBeNull();
  });

  it('picking a tab switches to it', () => {
    const p = setup();
    fireEvent.click(within(group('Tabs')!).getAllByRole('option')[1]!);
    expect(p.onTab).toHaveBeenCalledWith('t3');
    expect(p.onClose).toHaveBeenCalled();
  });

  it('without tabs, nothing changes', () => {
    setup({ tabs: undefined });
    expect(group('Tabs')).toBeNull();
    expect(group('Headings')).toBeTruthy();
  });
});
