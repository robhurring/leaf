import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { threeBundle } from './three-bundle.js';

export default defineConfig({
  plugins: [react(), threeBundle()],
  test: {
    name: 'ui',
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        settings: { disableIframePageLoading: true, disableJavaScriptFileLoading: true },
      },
    },
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/polyfills.ts', 'test/setup.ts'],
    css: false,
  },
});
