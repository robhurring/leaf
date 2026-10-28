import type { FileMessage } from '@leaf/protocol';
import type { Viewer } from './types.js';

export type ViewerRegistry = {
  register(viewer: Viewer): () => void;
  forFile(file: FileMessage): Viewer;
  forLang(lang: string): Viewer | undefined;
  byId(id: string): Viewer | undefined;
  all(): Viewer[];
};

const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

export function createViewerRegistry(fallbackId = 'binary'): ViewerRegistry {
  const list: Viewer[] = [];
  const matchMime = (v: Viewer, mime: string) =>
    v.matches.mime?.some((m) =>
      m.endsWith('/*') ? mime.startsWith(m.slice(0, -1)) : m === mime,
    ) ?? false;
  return {
    register(viewer) {
      const i = list.findIndex((v) => v.id === viewer.id);
      if (i >= 0) list[i] = viewer;
      else list.push(viewer);
      return () => {
        const j = list.indexOf(viewer);
        if (j >= 0) list.splice(j, 1);
      };
    },
    forFile(file) {
      const ext = extOf(file.path);
      return (
        list.find((v) => ext && v.matches.ext?.includes(ext)) ??
        list.find((v) => matchMime(v, file.mime)) ??
        list.find((v) => v.matches.kind?.includes(file.kind)) ??
        list.find((v) => v.id === fallbackId)!
      );
    },
    forLang(lang) {
      return list.find((v) => v.matches.lang?.includes(lang.toLowerCase()));
    },
    byId(id) {
      return list.find((v) => v.id === id);
    },
    all() {
      return [...list];
    },
  };
}
