// A viewer renders one kind of content in two sizes: Inline (inside a document
// flow, e.g. a fenced block) and Rich (the whole-file experience, also what the
// Stage shows on zoom-in).
import type { FC, ReactNode } from 'react';
import type { Config, FileMessage } from '@leaf/protocol';
import type { Handlers } from '../render/handlers.js';

export type ViewerProps = {
  file: FileMessage;
  /** Text content when the file was inlined, or the fenced block's source. */
  content?: string;
  docPath: string;
  config: Config;
  handlers?: Handlers;
  numbering?: boolean;
  linkBase?: string;
  /** A fenced block's info string after the language (`height=480`); '' when none. */
  meta?: string;
  /** Forces a light or dark rendering; otherwise the document's appearance applies. */
  appearance?: 'light' | 'dark';
};

export type Action = {
  id: string;
  label: string;
  icon: FC<{ size?: number }>;
  run(ctx: ViewerProps): void | Promise<void>;
};

export interface Viewer {
  id: string;
  matches: { ext?: string[]; lang?: string[]; mime?: string[]; kind?: string[] };
  Inline: FC<ViewerProps>;
  Rich: FC<ViewerProps>;
  stage?: { pan?: boolean; zoom?: boolean; draw?: boolean };
  actions?: Action[];
}

export type ViewerRender = (props: ViewerProps) => ReactNode;
