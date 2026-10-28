// What the browser displays natively: PDF, audio, video.
import type { Viewer, ViewerProps } from '../types.js';
import { useFileUrl } from '../fileUrl.js';
import { BinaryCard } from '../binary/index.js';

function Media({ file, ...rest }: ViewerProps) {
  const url = useFileUrl(file) ?? undefined;
  if (file.mime === 'application/pdf')
    return <iframe className="leaf-media leaf-pdf" src={url} title={file.path} />;
  if (file.mime.startsWith('audio/')) return <audio className="leaf-media" controls src={url} />;
  if (file.mime.startsWith('video/')) return <video className="leaf-media" controls src={url} />;
  return <BinaryCard file={file} {...rest} />;
}

export const media: Viewer = {
  id: 'media',
  matches: { mime: ['application/pdf', 'audio/*', 'video/*'], kind: ['media', 'pdf'] },
  Inline: Media,
  Rich: Media,
};
