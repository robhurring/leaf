// Where a whole-file viewer loads its bytes from: an object URL built from the
// inline base64 when the file came that way, else the server's URL. In a browser
// share, file.url is the host's own (leaf-raw://), so the welcome's rawBase wins.
import { useEffect, useState } from 'react';
import type { FileMessage } from '@leaf/protocol';
import { base64ToBlob } from '../store/assets.js';
import { useDocuments } from '../store/documents.js';
import { rawUrl } from '../render/components/assetContext.js';

/** The URL of `file`'s bytes as this source serves them. */
export function useRawUrl(file: FileMessage): string {
  const caps = useDocuments((s) => s.capabilities);
  return caps?.rawUrls && caps.rawBase ? rawUrl(file.path, caps.rawBase) : file.url;
}

/** Null while an inline file's object URL is being made. Each mount makes and revokes its
 *  own URL, so a remount (strict mode, the Stage) never points at a revoked one. */
export function useFileUrl(file: FileMessage): string | null {
  const inline = file.encoding === 'base64' && file.content !== undefined;
  const raw = useRawUrl(file);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inline) return setUrl(null);
    const made = URL.createObjectURL(base64ToBlob(file.content!, file.mime));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [inline, file.content, file.mime]);
  return inline ? url : `${raw}?t=${file.mtime}`;
}
