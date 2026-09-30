import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui', fullyParallel: true, timeout: 30000,
  expect: { timeout: 8000 }, retries: 0, workers: 2,
  reporter: 'list', outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:3100/test-box/',
    viewport: { width: 390, height: 844 },
    launchOptions: process.platform === 'darwin' ? { channel: 'chrome' } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-ui-test.mjs',
    url: 'http://127.0.0.1:3100/test-box/', reuseExistingServer: process.env.PW_REUSE_SERVER === '1', timeout: 180000, stdout: 'pipe',
    env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3100', NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', NEXT_PUBLIC_BASE_PATH: '/test-box' },
  },
});
