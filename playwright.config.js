// @ts-check
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env so POOLPRO_EMAIL / POOLPRO_PASSWORD are available in global-setup
loadEnv();

const AUTH_STATE = path.join(__dirname, 'tests', '.auth', 'supervisor.json');

export default defineConfig({
  testDir: './tests',

  // Runs tests/global-setup.js once before the suite to log in and save auth state.
  // Skip by setting SKIP_GLOBAL_SETUP=1 (e.g. when auth state is already fresh).
  globalSetup: process.env.SKIP_GLOBAL_SETUP ? undefined : './tests/global-setup.js',

  snapshotDir: './tests/snapshots',
  outputDir:   './tests/results',
  fullyParallel: true,
  retries: 0,
  reporter: [['html', { outputFolder: 'tests/report', open: 'never' }], ['line']],

  use: {
    baseURL: 'http://localhost:5000',
    // Restore the saved supervisor session for every test
    storageState: AUTH_STATE,
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
    command: 'npx serve . -l 5000 --no-clipboard',
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
  },
});
