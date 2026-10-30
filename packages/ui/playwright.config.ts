import { defineConfig, devices } from '@playwright/test';

const port = 4599;

// Runs the built app through the real leaf server on the docs/examples folder.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  // The UI runs in the app's WebKit webview and, as the share viewer, in any browser.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    // A clean config dir each run: the sticky-settings test assumes defaults.
    // The leaf binary under test; bin/test passes the release build.
    command: `rm -rf ../../.superpowers/e2e-config && ${process.env.LEAF_BIN ?? '../../target/release/leaf'} serve ../../docs/examples --port ${port} --host 127.0.0.1`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    // A scratch config dir so the sticky-settings test never touches the real preferences file.
    env: {
      LEAF_STATIC_DIR: 'dist/app',
      LOG_LEVEL: 'warn',
      LEAF_CONFIG_DIR: '../../.superpowers/e2e-config',
    },
    timeout: 20_000,
  },
});
