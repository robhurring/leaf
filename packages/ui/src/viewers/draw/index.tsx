// Freeform drawing: ```draw blocks and .draw files. The picture is a blank sheet and
// the Stage does the rest (pencil, brushes, ink, undo, pan, zoom, copy, download), in
// the file's panel or right in the block. Drawings last for the session; nothing is
// written to the file.
import type { Viewer, ViewerProps } from '../types.js';
import { StageCanvas } from '../../stage/Stage.js';
import { paneHeight } from '../live/frame.js';
import { contentHash } from '../hash.js';

/** `size: 800x450` sets the sheet; anything else in the block is a note to yourself. */
export function sheetSize(code: string): { w: number; h: number } {
  const m = /^\s*size:\s*(\d+)\s*[x×]\s*(\d+)/im.exec(code);
  const clamp = (n: number) => Math.min(4000, Math.max(100, n));
  return m ? { w: clamp(Number(m[1])), h: clamp(Number(m[2])) } : { w: 800, h: 450 };
}

/** The sheet itself: paper the Stage's ink layer draws on. */
function Sheet(props: ViewerProps) {
  const { w, h } = sheetSize(props.content ?? '');
  return (
    <div className="leaf-diagram leaf-draw-sheet">
      <svg xmlns="http://www.w3.org/2000/svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <rect width={w} height={h} fill="#ffffff" />
      </svg>
    </div>
  );
}

/** In a document: a small Stage of its own, the toolbox floating at its foot. */
function DrawBlock(props: ViewerProps) {
  const blockHash = contentHash(props.content ?? '');
  return (
    <div className="leaf-draw-block" style={{ height: paneHeight(props.meta) }}>
      <StageCanvas
        content={{ docPath: props.docPath, blockHash, viewer: draw, props, lang: 'draw' }}
        inline
        embedded
      />
    </div>
  );
}

export const draw: Viewer = {
  id: 'draw',
  matches: { ext: ['.draw'], lang: ['draw'] },
  Inline: DrawBlock,
  Rich: Sheet,
  stage: { pan: true, zoom: true, draw: true, sheet: true },
};
