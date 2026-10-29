// CodeMirror 6 configuration for a read-only file view, bound to leaf's tokens.
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  type Extension,
} from '@codemirror/state';
import type { BlameHunk } from '@leaf/protocol';
import { blameLabel, blameTitle, freshness, hunkAt } from '../../blame.js';
import {
  EditorView,
  GutterMarker,
  gutter,
  gutterLineClass,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
  keymap,
} from '@codemirror/view';
import { RangeSet } from '@codemirror/state';
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  type LanguageDescription,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

const theme = EditorView.theme({
  '&': {
    font: 'var(--leaf-font-mono)',
    fontSize: '13px',
    background: 'var(--leaf-block-bg)',
    color: 'var(--leaf-text)',
  },
  '.cm-gutters': {
    background: 'transparent',
    color: 'var(--leaf-text-2)',
    border: 'none',
    borderRight: '1px solid var(--leaf-line)',
  },
  // Line numbers are click targets (select a line, shift-click a range): show it.
  '.cm-lineNumbers .cm-gutterElement': { cursor: 'pointer', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--leaf-text)' },
  '.cm-activeLine': { background: 'transparent' },
  '.cm-gutterElement.cm-selectedLineGutter': {
    background: 'var(--leaf-accent-soft)',
    color: 'var(--leaf-text)',
  },
  '.cm-selectionBackground, ::selection': { background: 'var(--leaf-accent-soft) !important' },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { padding: '0 16px' },
});

export function languageFor(
  lang: string | undefined,
  path: string,
): LanguageDescription | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    (lang
      ? languages.find((l) => l.name.toLowerCase() === lang || l.alias.includes(lang))
      : undefined) ??
    languages.find(
      (l) =>
        l.filename?.test(name) || l.extensions.some((e) => name.toLowerCase().endsWith('.' + e)),
    )
  );
}

/** Gutter cells of selected lines get a class so the number is highlighted with the line. */
const selectedGutter = new (class extends GutterMarker {
  elementClass = 'cm-selectedLineGutter';
})();
const selectedLineGutter = gutterLineClass.compute(['selection'], (state) => {
  const marks = [];
  const { from, to } = state.selection.main;
  if (from === to) return RangeSet.empty;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) marks.push(selectedGutter.range(state.doc.line(n).from));
  return RangeSet.of(marks);
});

const anchors = new WeakMap<EditorView, number>();

/** Selects line `n` (1-based); with `extend`, selects from the last clicked line to `n`. */
export function selectLines(view: EditorView, n: number, extend: boolean): void {
  const total = view.state.doc.lines;
  const target = Math.min(Math.max(1, n), total);
  const anchor = extend ? (anchors.get(view) ?? target) : target;
  if (!extend) anchors.set(view, target);
  const first = view.state.doc.line(Math.min(anchor, target));
  const last = view.state.doc.line(Math.max(anchor, target));
  view.dispatch({ selection: EditorSelection.single(first.from, last.to), scrollIntoView: true });
}

/** The 1-based line range of the main selection. */
export function selectedLineRange(view: EditorView): { from: number; to: number } {
  const { from, to } = view.state.selection.main;
  return { from: view.state.doc.lineAt(from).number, to: view.state.doc.lineAt(to).number };
}

/** Blame as the editor shows it: the hunks, and which ones show their label. */
export type EditorBlame = {
  hunks: BlameHunk[];
  /** Every hunk shows its label. */
  details: boolean;
  /** Start lines of the hunks expanded one by one. */
  open: ReadonlySet<number>;
  /** A click on a hunk's cells. */
  onToggle(start: number): void;
};

/** One gutter cell: a bar shaded by the commit's freshness; the label on a hunk's first line. */
class BlameCell extends GutterMarker {
  constructor(
    readonly hunk: BlameHunk,
    readonly first: boolean,
    readonly label: boolean,
    readonly fresh: number,
  ) {
    super();
  }
  eq(o: BlameCell): boolean {
    return (
      o.hunk === this.hunk &&
      o.first === this.first &&
      o.label === this.label &&
      o.fresh === this.fresh
    );
  }
  toDOM(): Node {
    const el = document.createElement('div');
    el.className = `leaf-blame-cell${this.first ? ' leaf-blame-first' : ''}${this.hunk.uncommitted ? ' leaf-blame-uncommitted' : ''}`;
    el.style.setProperty('--leaf-blame-fresh', String(this.fresh));
    el.title = blameTitle(this.hunk);
    if (this.label) {
      const text = document.createElement('span');
      text.className = 'leaf-blame-label';
      text.textContent = blameLabel(this.hunk);
      el.appendChild(text);
    }
    return el;
  }
}

function blameGutter(b: EditorBlame): Extension {
  const fresh = freshness(b.hunks);
  const labels = b.details || b.open.size > 0;
  // The widest label sizes the gutter, so it doesn't jump as lines scroll in.
  const widest = b.hunks.reduce<BlameHunk | undefined>(
    (w, h) => (!w || blameLabel(h).length > blameLabel(w).length ? h : w),
    undefined,
  );
  return gutter({
    class: 'cm-blame-gutter',
    lineMarker(view, line) {
      const n = view.state.doc.lineAt(line.from).number;
      const h = hunkAt(b.hunks, n);
      if (!h) return null;
      const first = n === h.start;
      const label = first && (b.details || b.open.has(h.start));
      return new BlameCell(h, first, label, fresh.get(h.commit) ?? 1);
    },
    initialSpacer: () =>
      labels && widest
        ? new BlameCell(widest, true, true, 1)
        : new BlameCell(b.hunks[0]!, false, false, 1),
    domEventHandlers: {
      mousedown(view, line) {
        const h = hunkAt(b.hunks, view.state.doc.lineAt(line.from).number);
        if (h) b.onToggle(h.start);
        return true;
      },
    },
  });
}

const blame = new Compartment();

/** Shows blame in the gutter of a live view, or takes it away (null). */
export function setBlame(view: EditorView, b: EditorBlame | null): void {
  view.dispatch({ effects: blame.reconfigure(b && b.hunks.length ? blameGutter(b) : []) });
}

// Token colors follow the page's appearance; swapped live through a compartment.
const appearance = new Compartment();
const appearanceExtension = (dark: boolean): Extension => [
  syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle, { fallback: true }),
  EditorView.editorAttributes.of({ class: dark ? 'leaf-cm-dark' : 'leaf-cm-light' }),
];

/** Switches the token colors of a live view. */
export function setDark(view: EditorView, dark: boolean): void {
  view.dispatch({ effects: appearance.reconfigure(appearanceExtension(dark)) });
}

/** Creates the view at once (plain text) and appends the language mode when it has loaded. */
export function createReadOnlyView(
  parent: HTMLElement,
  doc: string,
  lang: string | undefined,
  path: string,
  wrap: boolean,
  onSelectLines?: (range: { from: number; to: number }) => void,
  dark = false,
): EditorView {
  const extensions: Extension[] = [
    // Before the line numbers, so blame is the outermost gutter.
    blame.of([]),
    lineNumbers({
      domEventHandlers: {
        mousedown(view, line, event) {
          const n = view.state.doc.lineAt(line.from).number;
          selectLines(view, n, (event as MouseEvent).shiftKey);
          onSelectLines?.(selectedLineRange(view));
          return true;
        },
      },
    }),
    selectedLineGutter,
    highlightSpecialChars(),
    drawSelection(),
    search({ top: true }),
    highlightSelectionMatches(),
    appearance.of(appearanceExtension(dark)),
    keymap.of([...searchKeymap, ...defaultKeymap]),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    theme,
  ];
  if (wrap) extensions.push(EditorView.lineWrapping);
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions }) });
  const desc = languageFor(lang, path);
  if (desc) {
    desc
      .load()
      .then((support) => view.dispatch({ effects: StateEffect.appendConfig.of(support) }))
      .catch(() => {
        /* language unavailable: stay plain */
      });
  }
  return view;
}
