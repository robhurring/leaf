// Which icon a file or folder gets, by kind and extension: the tree and the tab row.
import type { Entry } from '@leaf/protocol';
import {
  Code,
  Diagram,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Media,
} from '../icons/index.js';

const ICON_BY_EXT: Record<string, typeof FileIcon> = {
  '.png': ImageIcon,
  '.jpg': ImageIcon,
  '.jpeg': ImageIcon,
  '.gif': ImageIcon,
  '.svg': ImageIcon,
  '.webp': ImageIcon,
  '.mmd': Diagram,
  '.puml': Diagram,
  '.excalidraw': Diagram,
  '.drawio': Diagram,
  '.mp4': Media,
  '.mp3': Media,
  '.webm': Media,
  '.wav': Media,
  '.pdf': Media,
  '.ts': Code,
  '.tsx': Code,
  '.js': Code,
  '.py': Code,
  '.rb': Code,
  '.go': Code,
  '.rs': Code,
  '.sh': Code,
  '.json': Code,
  '.yaml': Code,
  '.yml': Code,
  '.toml': Code,
  '.css': Code,
  '.html': Code,
};
/** The icon for a tree entry: a folder, or the file's kind by its extension. */
export const iconFor = (e: Pick<Entry, 'kind' | 'name'>) => {
  if (e.kind === 'dir') return Folder;
  const dot = e.name.lastIndexOf('.');
  return (dot > 0 && ICON_BY_EXT[e.name.slice(dot).toLowerCase()]) || FileIcon;
};
