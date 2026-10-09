import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', baseURL: 'http://localhost:8888' },
  webServer: { command: 'npm run dev', url: 'http://localhost:8888/b/demo', reuseExistingServer: !process.env.CI },
});
