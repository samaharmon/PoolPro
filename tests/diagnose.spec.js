/**
 * Diagnostic sweep — runs headlessly across all pages and collects:
 *   • JS console errors and uncaught exceptions
 *   • Failed network requests (4xx, 5xx, net::ERR_*)
 *   • Missing structural elements (nav, main content landmark)
 *   • Slow page loads (> 8 s to networkidle)
 *
 * Results are written to tests/results/issues.json for Claude Code to read.
 * Run via:  npm run test:diagnose
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const PAGES = [
  { name: 'home',         path: '/' },
  { name: 'main-home',    path: '/Main/home.html' },
  { name: 'chem-log',     path: '/chem/chem.html' },
  { name: 'duties',       path: '/duties/duties.html' },
  { name: 'des',          path: '/des/des.html' },
  { name: 'des-logbooks', path: '/des-logbooks/des-logbooks.html' },
  { name: 'inventory',    path: '/inventory/inventory.html' },
  { name: 'employees',    path: '/employees/employees.html' },
  { name: 'training',     path: '/Training/training.html' },
  { name: 'resources',    path: '/resources/resources.html' },
  { name: 'managerial',   path: '/managerial/managerial.html' },
  { name: 'operational',  path: '/operational/operational.html' },
  { name: 'editor',       path: '/Editor/newRules.html' },
  { name: 'todo',         path: '/todo/todo.html' },
  { name: 'testing',      path: '/testing/testing.html' },
];

// Structural landmarks that every authenticated page should have
const REQUIRED_SELECTORS = {
  'nav or header': 'nav, header, [role="navigation"]',
  'main content':  'main, [role="main"], .main-content, #mainContent, .container, section',
};

// Console messages to ignore (Firebase SDK noise, expected warnings, etc.)
const IGNORED_PATTERNS = [
  /^\[Firebase\]/i,
  /^Download the React DevTools/i,
  /^%cFirebase/,
  /favicon/i,
  /serviceWorker/i,
  /PoolPro\] (Unable|Could not)/i,  // app-level soft warnings already handled
];

const allIssues = [];

function shouldIgnore(text) {
  return IGNORED_PATTERNS.some((re) => re.test(text));
}

// ── One test per page ────────────────────────────────────────────────────────

for (const { name, path: pagePath } of PAGES) {
  test(`diagnose: ${name}`, async ({ page }, testInfo) => {
    const issues = [];

    // ── Collect console errors ───────────────────────────────────────────────
    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      const text = msg.text();
      if (shouldIgnore(text)) return;
      issues.push({
        type: msg.type() === 'error' ? 'console-error' : 'console-warning',
        message: text,
        location: msg.location()?.url || '',
      });
    });

    // ── Collect uncaught exceptions ──────────────────────────────────────────
    page.on('pageerror', (err) => {
      if (shouldIgnore(err.message)) return;
      issues.push({
        type: 'uncaught-exception',
        message: err.message,
        stack: err.stack?.split('\n').slice(0, 5).join('\n') || '',
      });
    });

    // ── Collect failed requests ──────────────────────────────────────────────
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Ignore third-party CDN failures (fonts, analytics) — focus on same-origin
      if (!url.startsWith('http://localhost') && !url.includes('/poolpro') && !url.endsWith('.html') && !url.endsWith('.js') && !url.endsWith('.css')) return;
      issues.push({
        type: 'request-failed',
        url,
        failure: req.failure()?.errorText || 'unknown',
      });
    });

    page.on('response', (resp) => {
      if (resp.status() < 400) return;
      const url = resp.url();
      if (!url.startsWith('http://localhost')) return;
      issues.push({
        type: 'http-error',
        url,
        status: resp.status(),
      });
    });

    // ── Navigate ─────────────────────────────────────────────────────────────
    const start = Date.now();
    try {
      await page.goto(pagePath, { waitUntil: 'networkidle', timeout: 12_000 });
    } catch {
      await page.goto(pagePath, { waitUntil: 'load', timeout: 12_000 });
      await page.waitForTimeout(2000);
    }
    const elapsed = Date.now() - start;

    if (elapsed > 8000) {
      issues.push({ type: 'slow-load', ms: elapsed });
    }

    // Give JS a moment to finish initializing
    await page.waitForTimeout(800);

    // ── Check structural selectors ────────────────────────────────────────────
    for (const [label, selector] of Object.entries(REQUIRED_SELECTORS)) {
      const count = await page.locator(selector).count();
      if (count === 0) {
        issues.push({ type: 'missing-element', label, selector });
      }
    }

    // ── Take a screenshot for reference ──────────────────────────────────────
    const screenshotDir = path.join(import.meta.dirname, 'screenshots', 'diagnose');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // ── Record result ─────────────────────────────────────────────────────────
    const result = {
      page: name,
      url: pagePath,
      screenshotPath,
      loadMs: elapsed,
      issues,
    };
    allIssues.push(result);

    // Attach issues to the test report
    testInfo.annotations.push({
      type: 'issues',
      description: JSON.stringify(issues, null, 2),
    });

    // Mark test as failed if any errors (not warnings) were found
    const errors = issues.filter((i) =>
      ['console-error', 'uncaught-exception', 'http-error', 'missing-element'].includes(i.type)
    );
    if (errors.length) {
      const summary = errors.map((e) => `[${e.type}] ${e.message || e.url || e.label || ''}`).join('\n');
      throw new Error(`${errors.length} issue(s) found on "${name}":\n${summary}`);
    }
  });
}

// ── Write the consolidated issues file after all tests run ──────────────────
test.afterAll(async () => {
  const resultsDir = path.join(import.meta.dirname, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const issuesPath = path.join(resultsDir, 'issues.json');
  const summary = {
    runAt: new Date().toISOString(),
    totalPages: allIssues.length,
    pagesWithIssues: allIssues.filter((r) => r.issues.length > 0).length,
    results: allIssues,
  };
  fs.writeFileSync(issuesPath, JSON.stringify(summary, null, 2));
  console.log(`\n[diagnose] Report written → ${issuesPath}`);

  const totalIssues = allIssues.reduce((n, r) => n + r.issues.length, 0);
  if (totalIssues === 0) {
    console.log('[diagnose] ✓ No issues found.');
  } else {
    console.log(`[diagnose] ✗ ${totalIssues} issue(s) across ${summary.pagesWithIssues} page(s). See ${issuesPath}`);
  }
});
