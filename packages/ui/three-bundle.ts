// three.js for live panes, as one classic script. A pane's frame is sandboxed with no
// origin of its own, so it can't load modules from leaf; leaf writes this script into
// the frame instead. It sets window.THREE and window.OrbitControls.
import { build } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const ID = 'virtual:leaf-three';
const RESOLVED = '\0' + ID;

const ENTRY = `
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
window.THREE = THREE;
window.OrbitControls = OrbitControls;
`;

export function threeBundle(): Plugin {
  return {
    name: 'leaf-three',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    async load(id) {
      if (id !== RESOLVED) return;
      const out = await build({
        stdin: {
          contents: ENTRY,
          resolveDir: dirname(fileURLToPath(import.meta.url)),
          loader: 'js',
        },
        bundle: true,
        format: 'iife',
        minify: true,
        legalComments: 'eof',
        write: false,
      });
      return `export default ${JSON.stringify(out.outputFiles[0]!.text)};`;
    },
  };
}
