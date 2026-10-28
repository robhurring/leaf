// What the Stage is showing and which drawing tool is active.
import { create } from 'zustand';
import type { Viewer, ViewerProps } from '../viewers/types.js';

export type StageTool = 'hand' | 'pencil';
export type InkColor = 'red' | 'green' | 'blue';
export type Brush = 'small' | 'medium' | 'large';

export const INK_COLORS: Record<InkColor, string> = {
  red: '#e5484d',
  green: '#30a46c',
  blue: '#3e82f7',
};
export const BRUSH_WIDTHS: Record<Brush, number> = { small: 2, medium: 4, large: 8 };

export type StageContent = {
  docPath: string;
  blockHash: string;
  viewer: Viewer;
  props: ViewerProps;
  /** The fence language when the block came from one; shown in the Stage title. */
  lang?: string;
};

export type StageState = {
  open: StageContent | null;
  tool: StageTool;
  color: InkColor;
  brush: Brush;
  sticky: boolean;
  openStage(content: StageContent): void;
  close(): void;
  setTool(t: StageTool): void;
  setColor(c: InkColor): void;
  setBrush(b: Brush): void;
  setSticky(v: boolean): void;
};

export const useStage = create<StageState>((set) => ({
  open: null,
  tool: 'hand',
  color: 'red',
  brush: 'medium',
  sticky: false,
  openStage: (content) => set({ open: content }),
  close: () => set({ open: null }),
  setTool: (tool) => set({ tool }),
  setColor: (color) => set({ color }),
  setBrush: (brush) => set({ brush }),
  setSticky: (sticky) => set({ sticky }),
}));
