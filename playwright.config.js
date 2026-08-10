// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  snapshotDir: './tests/snapshots',
  outputDir: './tests/results',
  fullyParallel: true,
  retries: 0,
  reporter: [['html', { outputFolder: 'tests/report', open: 'never' }], ['line']],

  use: {
    baseURL: 'http://localhost:5000',
    // Wait for network to be idle before screenshotting
    actionTimeout: 8000,
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],

  webServer: {
    // 'serve' ships as a local devDep — serves the project root statically
    command: 'npx serve . -l 5000 --no-clipboard',
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
  },
});
