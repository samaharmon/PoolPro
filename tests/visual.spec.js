// @ts-check
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ── Pages to screenshot ──────────────────────────────────────────────────────
const PAGES = [
  { name: 'home',          path: '/' },
  { name: 'main-home',     path: '/Main/home.html' },
  { name: 'chem-log',      path: '/chem/chem.html' },
  { name: 'duties',        path: '/duties/duties.html' },
  { name: 'des',           path: '/des/des.html' },
  { name: 'des-logbooks',  path: '/des-logbooks/des-logbooks.html' },
  { name: 'inventory',     path: '/inventory/inventory.html' },
  { name: 'employees',     path: '/employees/employees.html' },
  { name: 'training',      path: '/Training/training.html' },
  { name: 'resources',     path: '/resources/resources.html' },
  { name: 'managerial',    path: '/managerial/managerial.html' },
  { name: 'operational',   path: '/operational/operational.html' },
  { name: 'editor',        path: '/Editor/newRules.html' },
  { name: 'todo',          path: '/todo/todo.html' },
  { name: 'testing',       path: '/testing/testing.html' },
];

// Wait selector: resolve when the page has stopped loading major network
// resources (Firebase SDK, fonts). Falls back to a 2s delay if needed.
const SETTLE_TIMEOUT = 5000;

// ── Snapshot output folder (alongside spec file) ─────────────────────────────
const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Navigate to a URL and wait for the page to visually settle.
 * We wait for networkidle, then an extra tick to let JS-driven animations
 * finish their first frame.
 */
async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(async () => {
    // networkidle can time out on pages with long-polling; fall back to load
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(2000);
  });
  // Let CSS transitions finish
  await page.waitForTimeout(500);
}

/**
 * Save a screenshot to tests/screenshots/<project>/<name>.png
 * (used by the capture mode; the compare mode uses toHaveScreenshot instead).
 */
async function saveShot(page, projectName, pageName) {
  const dir = path.join(SCREENSHOT_DIR, projectName);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${pageName}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

// ── Test mode detection ───────────────────────────────────────────────────────
// Set VISUAL_MODE=compare to run snapshot comparison (fails on pixel diff).
// Default (VISUAL_MODE=capture or unset) just saves screenshots for review.
const COMPARE_MODE = process.env.VISUAL_MODE === 'compare';

// ── Tests ─────────────────────────────────────────────────────────────────────

for (const { name, path: pagePath } of PAGES) {
  test.describe(name, () => {
    test(`${name} — above-the-fold`, async ({ page, browserName }, testInfo) => {
      await gotoAndSettle(page, pagePath);

      if (COMPARE_MODE) {
        // Snapshot comparison: update baselines with --update-snapshots
        await expect(page).toHaveScreenshot(`${name}-above-fold.png`, {
          maxDiffPixelRatio: 0.02,
          animations: 'disabled',
        });
      } else {
        const out = await saveShot(page, testInfo.project.name, `${name}-above-fold`);
        testInfo.annotations.push({ type: 'screenshot', description: out });
        console.log(`  ✓ saved ${out}`);
      }
    });

    test(`${name} — full page`, async ({ page, browserName }, testInfo) => {
      await gotoAndSettle(page, pagePath);

      if (COMPARE_MODE) {
        await expect(page).toHaveScreenshot(`${name}-full.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.02,
          animations: 'disabled',
        });
      } else {
        const dir = path.join(SCREENSHOT_DIR, testInfo.project.name);
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `${name}-full.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        testInfo.annotations.push({ type: 'screenshot', description: filePath });
        console.log(`  ✓ saved ${filePath}`);
      }
    });
  });
}
