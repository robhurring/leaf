// A file a document reads its data from (a chart's CSV, a map's GeoJSON), by a path
// relative to the document. Read through the documents store and read again whenever
// it changes on disk.
import { useEffect, useMemo } from 'react';
import { useDocuments } from '../store/documents.js';
import { resolveRelative } from '../render/paths.js';

export type DataFile = { path: string; text?: string; error?: string };

export function useDataFile(docPath: string, rel: string | undefined): DataFile {
  const path = rel ? resolveRelative(docPath, rel) : '';
  const file = useDocuments((s) => (path ? s.files[path] : undefined));
  const failed = useDocuments((s) => (path ? s.errors[path] : undefined));
  useEffect(() => (path ? useDocuments.getState().watch(path) : undefined), [path]);
  // The same object until the file itself changes, so views that depend on it don't
  // redo their work on every unrelated redraw.
  return useMemo((): DataFile => {
    if (!path) return { path };
    if (failed) return { path, error: `Couldn't read ${path}: ${failed.message}` };
    if (file?.encoding === 'utf8' && file.content !== undefined)
      return { path, text: file.content };
    if (file) return { path, error: `${path} isn't a text file` };
    return { path };
  }, [path, failed, file]);
}
