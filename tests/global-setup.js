/**
 * Playwright global setup — authenticates once as a supervisor and saves
 * browser storage state so every test starts already logged in.
 *
 * Credentials come from environment variables (see .env.example):
 *   POOLPRO_EMAIL     — supervisor Firebase email
 *   POOLPRO_PASSWORD  — supervisor password
 *
 * Run `npx playwright test` normally; this file is wired in via
 * playwright.config.js globalSetup.  Re-run with --global-setup-only
 * to refresh the saved session without running the full suite.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, '.auth', 'supervisor.json');

export default async function globalSetup() {
  const email    = process.env.POOLPRO_EMAIL;
  const password = process.env.POOLPRO_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Set POOLPRO_EMAIL and POOLPRO_PASSWORD environment variables before running tests.\n' +
      'Copy .env.example to .env and fill in your supervisor credentials.'
    );
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: 'http://localhost:5000' });
  const page    = await context.newPage();

  // ── Navigate to the home page ──────────────────────────────────────────────
  await page.goto('/Main/home.html', { waitUntil: 'networkidle' });

  // ── Open the supervisor login modal ───────────────────────────────────────
  await page.click('button[data-access-role="supervisor"]');

  // Wait for the login form to appear
  await page.waitForSelector('#homeLoginForm', { state: 'visible' });

  // ── Fill in credentials ────────────────────────────────────────────────────
  await page.fill('#homeUsernameInput', email);
  await page.fill('#homePasswordInput', password);
  await page.click('#homeLoginSubmit');

  // ── Wait for login to complete ─────────────────────────────────────────────
  // The app sets localStorage.loginToken once Firebase auth succeeds.
  // We poll for it rather than waiting on a navigation (login stays on same page).
  await page.waitForFunction(
    () => {
      try {
        const token = JSON.parse(localStorage.getItem('loginToken') || 'null');
        return token && token.expires > Date.now() && token.verificationVersion >= 1;
      } catch { return false; }
    },
    null,
    { timeout: 30_000, polling: 500 }
  );

  // ── Save the full browser storage state ───────────────────────────────────
  // This captures localStorage (loginToken, ChemLogSupervisor, chemlogRole, etc.)
  // and sessionStorage — everything isSupervisor() and the rest of the app checks.
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });

  await browser.close();

  console.log(`[auth] Supervisor session saved → ${STATE_PATH}`);
}
