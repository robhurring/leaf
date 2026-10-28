import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FileMessage } from '@leaf/protocol';
import { Properties } from '../src/components/Properties.js';

const file: FileMessage = {
  type: 'file',
  path: 'docs/guide.md',
  kind: 'markdown',
  mime: 'text/markdown',
  encoding: 'utf8',
  content: '#',
  url: '/raw/docs/guide.md',
  size: 1234,
  mtime: 1700000000000,
  git: {
    commit: 'abcdef1234567890',
    author: 'Rob',
    date: 1700000000000,
    message: 'docs: guide (#42)',
    repoUrl: 'https://github.com/rob/leaf',
  },
};

describe('Properties', () => {
  it('is collapsed by default and expands to a key/value table', () => {
    render(
      <Properties
        file={file}
        frontmatter={{
          title: 'Guide',
          tags: ['a', 'b'],
          draft: false,
          site: 'https://example.com',
        }}
      />,
    );
    const toggle = screen.getByRole('button', { name: /properties/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(toggle);
    const table = screen.getByRole('table');
    const text = table.textContent!;
    expect(text).toContain('docs/guide.md');
    expect(text).toContain('1.2 KB');
    expect(text).toContain('Rob');
    expect(text).toContain('Guide');
    expect(within(table).getByRole('link', { name: 'abcdef1' }).getAttribute('href')).toBe(
      'https://github.com/rob/leaf/commit/abcdef1234567890',
    );
    expect(within(table).getByRole('link', { name: '#42' }).getAttribute('href')).toBe(
      'https://github.com/rob/leaf/pull/42',
    );
    expect(
      within(table)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['a', 'b']);
    expect(within(table).getByRole('link', { name: 'https://example.com' })).toBeTruthy();
    expect(text).toContain('No');
  });

  it('shows the commit without links when there is no remote', () => {
    render(<Properties file={{ ...file, git: { ...file.git!, repoUrl: undefined } }} />);
    fireEvent.click(screen.getByRole('button', { name: /properties/i }));
    expect(screen.queryByRole('link', { name: 'abcdef1' })).toBeNull();
    expect(screen.getByRole('table').textContent).toContain('abcdef1');
  });

  it('line one: the path, then created, modified, and the properties toggle on the right', () => {
    const now = Date.now();
    render(
      <Properties
        file={{ ...file, mtime: now - 3 * 3_600_000, created: now - 70 * 86_400_000 }}
        frontmatter={{ title: 'Guide', tags: ['a'] }}
      />,
    );
    const head = screen.getByRole('region', { name: 'File' });
    const one = head.querySelector<HTMLElement>('.leaf-dochead-main')!;
    expect(within(one).getByLabelText('Path').textContent).toBe('docs/guide.md');
    // Dates carry an icon and a relative time; the exact date and what it is show on hover.
    const created = within(one).getByLabelText(/^Created/);
    const modified = within(one).getByLabelText(/^Modified/);
    expect(created.querySelector('svg')).toBeTruthy();
    expect(created.textContent).toBe('2 months ago');
    expect(modified.textContent).toBe('3 hours ago');
    expect(modified.getAttribute('title')).toMatch(/^Modified /);
    expect(within(one).getByRole('button', { name: /properties/i })).toBeTruthy();
  });

  it('line two is git, when there is git, as a git log line: sha, subject, when, author', () => {
    const now = Date.now();
    render(<Properties file={{ ...file, git: { ...file.git!, date: now - 2 * 86_400_000 } }} />);
    const two = document.querySelector<HTMLElement>('.leaf-dochead-git')!;
    const sha = within(two).getByRole('link', { name: 'abcdef1' });
    expect(sha.getAttribute('href')).toBe('https://github.com/rob/leaf/commit/abcdef1234567890');
    expect(within(two).getByRole('link', { name: '#42' }).getAttribute('href')).toBe(
      'https://github.com/rob/leaf/pull/42',
    );
    expect(two.textContent).toBe('abcdef1 docs: guide #42 (2 days ago) <Rob>');
  });

  it('without git there is no second line; properties still open with the file facts', () => {
    render(<Properties file={{ ...file, git: undefined }} />);
    expect(document.querySelector('.leaf-dochead-git')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /properties/i }));
    expect(screen.getByRole('table').textContent).toContain('1.2 KB');
  });

  it('a long path shortens its folders to fit, keeping the file name whole', () => {
    render(<Properties file={{ ...file, path: 'alpha/beta/gamma/deep/filename.md' }} />);
    const path = screen.getByLabelText('Path');
    // The full path is always available on hover.
    expect(path.getAttribute('title')).toBe('alpha/beta/gamma/deep/filename.md');
    expect(path.textContent).toMatch(/filename\.md$/);
  });

  it('properties expand down inside the header, with a badge counting the frontmatter', () => {
    render(<Properties file={file} frontmatter={{ title: 'Guide', tags: ['a'] }} />);
    const button = screen.getByRole('button', { name: /properties/i });
    expect(button.querySelector('.leaf-badge-count')!.textContent).toBe('2');
    fireEvent.click(button);
    const head = screen.getByRole('region', { name: 'File' });
    const panel = within(head).getByRole('table').closest('.leaf-props-panel')!;
    expect(panel).toBeTruthy();
    // Beneath the file line, part of the header rather than floating over the document.
    const row = head.querySelector('.leaf-dochead-git')!;
    expect(row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It stays open while reading; the toggle or Escape closes it.
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('frontmatter comes first, apart from the file facts; tags are pills even as a comma list', () => {
    render(<Properties file={file} frontmatter={{ title: 'Guide', tags: 'alpha, beta' }} />);
    fireEvent.click(screen.getByRole('button', { name: /properties/i }));
    const groups = screen.getAllByRole('rowgroup').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Frontmatter', 'File']);
    const pills = [...document.querySelectorAll('.leaf-pill')].map((p) => p.textContent);
    expect(pills).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('no frontmatter, no badge', () => {
    render(<Properties file={file} />);
    expect(document.querySelector('.leaf-badge-count')).toBeNull();
  });
});
