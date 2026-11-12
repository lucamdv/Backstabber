import { defineConfig } from '@playwright/test';

const liveUrl = process.env.BACKSTABBER_E2E_URL;
const baseURL = liveUrl ?? 'http://localhost:4177';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL, channel: 'chrome', reducedMotion: 'reduce',
    trace: 'off', screenshot: 'off', video: 'off',
  },
  webServer: liveUrl ? undefined : {
    command: 'npm run dev -- --host localhost --port 4177 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
  },
});
