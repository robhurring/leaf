// CodeMirror 6 configuration for a read-only file view, bound to leaf's tokens.
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  GutterMarker,
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
