// Anything the browser cannot display: an icon, the file's facts, a download link.
import type { Viewer, ViewerProps } from '../types.js';
import { formatBytes, formatDate } from './format.js';
import { useRawUrl } from '../fileUrl.js';

/** Text the source sent no content for: over the size it sends inline. */
function tooLarge(file: ViewerProps['file']): boolean {
  return (
    file.encoding === 'none' &&
    (file.mime.startsWith('text/') || ['markdown', 'code', 'csv'].includes(file.kind))
  );
}

/** A file that should have shown and didn't: said in place of an empty frame. */
export function LoadFailed({ name }: { name: string }) {
  return (
    <div className="leaf-load-failed" role="alert">
      Couldn’t load {name}. It may have moved, or be in a format this system can’t show.
    </div>
  );
}

export function BinaryCard({ file }: ViewerProps) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const href = useRawUrl(file);
  return (
    <div className="leaf-binary" role="group" aria-label={name}>
      <svg
        className="leaf-binary-icon"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      >
        <path d="M6 3h8l5 5v13H6z" />
        <path d="M14 3v5h5" />
      </svg>
      <div className="leaf-binary-name">{name}</div>
      {tooLarge(file) && <p className="leaf-binary-note">Too large to show here</p>}
      <dl className="leaf-binary-meta">
        <dt>Size</dt>
        <dd>{formatBytes(file.size)}</dd>
        <dt>Type</dt>
        <dd>{file.mime}</dd>
        <dt>Modified</dt>
        <dd>{formatDate(file.mtime)}</dd>
      </dl>
      <a className="leaf-button" href={href} download={name}>
        Download
      </a>
    </div>
  );
}

export const binary: Viewer = {
  id: 'binary',
  matches: { kind: ['binary'] },
  Inline: BinaryCard,
  Rich: BinaryCard,
};
