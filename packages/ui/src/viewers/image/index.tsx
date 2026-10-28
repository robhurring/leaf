// Images on a checkerboard so transparency shows. The file's facts live in the
// Properties panel. SVG goes through <img> too: inlining a file's markup would
// run its scripts in leaf's origin.
import type { Viewer, ViewerProps } from '../types.js';
import { useFileUrl } from '../fileUrl.js';

function Image({ file }: ViewerProps) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1);
  const url = useFileUrl(file);
  return (
    <div className="leaf-image-view">
      <div className="leaf-image-stage">
        {url && <img className="leaf-image" src={url} alt={name} />}
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
