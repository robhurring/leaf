// Images on a checkerboard so transparency shows. The file's facts live in the
// Properties panel. SVG goes through <img> too: inlining a file's markup would
// run its scripts in leaf's origin.
import { useState } from 'react';
import type { Viewer, ViewerProps } from '../types.js';
import { useFileUrl } from '../fileUrl.js';
import { LoadFailed } from '../binary/index.js';

function Image({ file }: ViewerProps) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const url = useFileUrl(file);
  // Busy until the picture is in: the Stage waits for it to center it at 1:1, rather
  // than measuring the alt text in its place.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const done = () => setLoaded(url);
  if (url && failed === url) return <LoadFailed name={name} />;
  return (
    <div className="leaf-image-view" aria-busy={!!url && loaded !== url}>
      <div className="leaf-image-stage">
        {url && (
          <img
            className="leaf-image"
            src={url}
            alt={name}
            onLoad={done}
            onError={() => (done(), setFailed(url))}
          />
        )}
      </div>
    </div>
  );
}

export const image: Viewer = {
  id: 'image',
  matches: { mime: ['image/*'], kind: ['image'] },
  Inline: Image,
  Rich: Image,
  stage: { pan: true, zoom: true, draw: true },
};
