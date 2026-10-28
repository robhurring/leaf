import { createBlockRegistry, type BlockRegistry } from './blocks.js';
import { createInlineRegistry, type InlineRegistry } from './inline.js';
import { createParserRegistry, type ParserRegistry } from './parsers.js';

export type Registries = { blocks: BlockRegistry; inline: InlineRegistry; parsers: ParserRegistry };

/** The app-wide registries. Plugins register here at module load. */
export const registries: Registries = {
  blocks: createBlockRegistry(),
  inline: createInlineRegistry(),
  parsers: createParserRegistry(),
};

export { createBlockRegistry, createInlineRegistry, createParserRegistry };
export type { BlockRegistry, BlockEntry, BlockCtx } from './blocks.js';
export type { InlineRegistry, InlineMatcher, InlineCtx, InlineResult } from './inline.js';
export type { ParserRegistry, ParserEntry } from './parsers.js';
