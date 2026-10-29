// Keyboard shortcuts for the reader chrome. Ignored while typing in a field.
export type ShortcutActions = {
  toggleTree(): void;
  toggleOutline(): void;
  toggleNumbering(): void;
  toggleAppearance(): void;
  /** ⌘K: headings of the open document. */
  openPalette(): void;
  /** ⌘O: files in the tree. */
  openFiles(): void;
  /** ⌘F: find in the open document. */
  openFind(): void;
  closeOverlays(): void;
  /** j/k scroll a line, ctrl-d/ctrl-u half a page, ctrl-f/ctrl-b a full page. */
  scrollBy(unit: 'line' | 'half' | 'page', direction: 1 | -1): void;
  /** ctrl-n/ctrl-p: the next or previous heading in the document. */
  jumpHeading(direction: 1 | -1): void;
  /** ⌘[ / ⌘] and the mouse's side buttons: the previous or next file viewed. */
  goBack?(): void;
  goForward?(): void;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
};

export function installShortcuts(
  actions: ShortcutActions,
  target: Window = window,
  /** When true (an overlay such as the Stage is open) only Escape is handled. */
  isBlocked: () => boolean = () => false,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return actions.closeOverlays();
    if (isBlocked()) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'k') {
      e.preventDefault();
      return actions.openPalette();
    }
    // ⌘F only: ctrl-f stays vim's page down.
    if (e.metaKey && !e.ctrlKey && k === 'f') {
      e.preventDefault();
      return actions.openFind();
    }
    if (e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      return e.key === '[' ? actions.goBack?.() : actions.goForward?.();
    }
    if (mod && k === 'o') {
      e.preventDefault();
      return actions.openFiles();
    }
    if (isTyping(e.target)) return;
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      if (k === 'd' || k === 'u') {
        e.preventDefault();
        return actions.scrollBy('half', k === 'd' ? 1 : -1);
      }
      if (k === 'f' || k === 'b') {
        e.preventDefault();
        return actions.scrollBy('page', k === 'f' ? 1 : -1);
      }
      if (k === 'n' || k === 'p') {
        e.preventDefault();
        return actions.jumpHeading(k === 'n' ? 1 : -1);
      }
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'j':
        e.preventDefault();
        return actions.scrollBy('line', 1);
      case 'k':
        e.preventDefault();
        return actions.scrollBy('line', -1);
      case '[':
        return actions.toggleTree();
      case ']':
        return actions.toggleOutline();
      case 'n':
        return actions.toggleNumbering();
      case 't':
        return actions.toggleAppearance();
    }
  };
  // Buttons 3 and 4 are a mouse's back and forward; the app window ignores them otherwise.
  const onMouse = (e: MouseEvent) => {
    if (isBlocked() || (e.button !== 3 && e.button !== 4)) return;
    e.preventDefault();
    if (e.button === 3) actions.goBack?.();
    else actions.goForward?.();
  };
  target.addEventListener('keydown', onKey);
  target.addEventListener('mouseup', onMouse);
  return () => {
    target.removeEventListener('keydown', onKey);
    target.removeEventListener('mouseup', onMouse);
  };
}
