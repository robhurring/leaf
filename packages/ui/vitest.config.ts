import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
