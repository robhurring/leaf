// Every control is a named command. A native menu item, a keyboard shortcut, and a
// button in the bar all invoke the same name, so which surface owns a control is a
// per-surface choice that never touches the UI's logic.
export const COMMANDS = [
  'toggleTree',
  'toggleOutline',
  'toggleNumbering',
  'toggleAppearance',
  'setAppearance',
  'openPalette',
  'openFiles',
  'openFind',
  'closeOverlays',
  'scrollBy',
  'jumpHeading',
  'textLarger',
  'textSmaller',
  'textReset',
] as const;
export type CommandName = (typeof COMMANDS)[number];
/** A command takes the argument its sender passes; method syntax keeps parameter types bivariant. */
type CommandFn = { run(arg?: unknown): void }['run'];
export type CommandTable = Partial<Record<CommandName, CommandFn>>;

let table: CommandTable = {};

/** Installs the live command implementations; returns the uninstaller. */
export function registerCommands(t: CommandTable): () => void {
  table = t;
  return () => {
    if (table === t) table = {};
  };
}

/** Runs a command by name. False when nothing is registered under that name. */
export function runCommand(name: string, arg?: unknown): boolean {
  const fn = (table as Record<string, ((arg?: unknown) => void) | undefined>)[name];
  if (!fn) return false;
  fn(arg);
  return true;
}
