import { defineConfig } from '@playwright/test';

const liveUrl = process.env.BACKSTABBER_E2E_URL;
const port = process.env.BACKSTABBER_E2E_PORT ?? '4177';
const baseURL = liveUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL, channel: 'chrome', reducedMotion: 'reduce',
    trace: 'off', screenshot: 'off', video: 'off',
  },
  webServer: liveUrl ? undefined : {
    command: `npm run dev -- --host localhost --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
