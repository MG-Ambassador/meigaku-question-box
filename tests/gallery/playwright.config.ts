import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'gallery.spec.ts', workers: 1, timeout: 60000,
  outputDir: '../../test-results/gallery',
  use: { baseURL: 'http://127.0.0.1:3101/test-box/', viewport: { width: 390, height: 844 }, launchOptions: process.platform === 'darwin' ? { channel: 'chrome' } : {} },
  webServer: {
    command: 'npm run dev -- --port 3101 --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3101/test-box/', timeout: 120000,
    env: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3101', NEXT_PUBLIC_BASE_PATH: '/test-box', NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' },
  },
});
