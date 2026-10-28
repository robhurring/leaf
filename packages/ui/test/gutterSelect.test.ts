import { describe, it, expect } from 'vitest';
import {
  createReadOnlyView,
  selectLines,
  selectedLineRange,
  setDark,
} from '../src/viewers/code/editor.js';

const doc = 'one\ntwo\nthree\nfour\nfive';

describe('gutter line selection', () => {
  it('click selects a whole line, shift-click extends to a range in either direction', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = createReadOnlyView(host, doc, 'text', 'a.txt', false);
    selectLines(view, 2, false);
    expect(selectedLineRange(view)).toEqual({ from: 2, to: 2 });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'two',
    );
    selectLines(view, 4, true);
    expect(selectedLineRange(view)).toEqual({ from: 2, to: 4 });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'two\nthree\nfour',
    );
    selectLines(view, 1, true);
    expect(selectedLineRange(view)).toEqual({ from: 1, to: 2 });
    selectLines(view, 5, false);
    expect(selectedLineRange(view)).toEqual({ from: 5, to: 5 });
    view.destroy();
    host.remove();
  });
});

describe('gutter highlight', () => {
  it('marks the gutter of every selected line', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = createReadOnlyView(host, doc, 'text', 'a.txt', false);
    selectLines(view, 2, false);
    selectLines(view, 3, true);
    const marked = [...host.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
      .filter((el) => el.classList.contains('cm-selectedLineGutter'))
      .map((el) => el.textContent);
    expect(marked).toEqual(['2', '3']);
    view.destroy();
    host.remove();
  });
});

describe('appearance', () => {
  it('the editor can be created dark and switched, carrying a class for the stylesheet', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const view = createReadOnlyView(host, doc, 'text', 'a.txt', false, undefined, true);
    expect(view.dom.classList.contains('leaf-cm-dark')).toBe(true);
    setDark(view, false);
    expect(view.dom.classList.contains('leaf-cm-dark')).toBe(false);
    setDark(view, true);
    expect(view.dom.classList.contains('leaf-cm-dark')).toBe(true);
    view.destroy();
    host.remove();
  });
});
