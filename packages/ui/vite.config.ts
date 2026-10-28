import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const serverPort = process.env.PORT ?? '4321';

// The app the leaf CLI serves. In dev, Vite fronts the page and proxies the
// protocol endpoints to the leaf server so the server code path is identical.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  appType: 'spa',
  build: { outDir: 'dist/app', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      '/raw': `http://127.0.0.1:${serverPort}`,
    },
  },
});
