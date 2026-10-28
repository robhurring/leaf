// Anything the browser cannot display: an icon, the file's facts, a download link.
import type { Viewer, ViewerProps } from '../types.js';
import { formatBytes, formatDate } from './format.js';

export function BinaryCard({ file }: ViewerProps) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
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
      <dl className="leaf-binary-meta">
        <dt>Size</dt>
        <dd>{formatBytes(file.size)}</dd>
        <dt>Type</dt>
        <dd>{file.mime}</dd>
        <dt>Modified</dt>
        <dd>{formatDate(file.mtime)}</dd>
      </dl>
      <a className="leaf-button" href={file.url} download={name}>
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
