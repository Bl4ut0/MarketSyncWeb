import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

/**
 * Resolves a local Chromium/Chrome/Edge executable path deterministically.
 */
export function resolveBrowserExecutable() {
  const checked = [];

  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath && envPath.trim().length > 0) {
    checked.push(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=${envPath}`);
    if (!fs.existsSync(envPath)) {
      throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH does not exist: ${envPath}`);
    }
    return { executablePath: envPath, channelLabel: 'env' };
  }

  const candidates = [
    {
      path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      channelLabel: 'chrome',
    },
    {
      path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      channelLabel: 'chrome-x86',
    },
    ...(process.env.LOCALAPPDATA
      ? [{
          path: path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          channelLabel: 'chrome-localappdata',
        }]
      : []),
    {
      path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      channelLabel: 'edge',
    },
    {
      path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      channelLabel: 'edge-x64',
    },
  ];

  for (const cand of candidates) {
    checked.push(cand.path);
    if (fs.existsSync(cand.path)) {
      return { executablePath: cand.path, channelLabel: cand.channelLabel };
    }
  }

  try {
    const pwPath = chromium.executablePath();
    if (pwPath) {
      checked.push(pwPath);
      if (fs.existsSync(pwPath)) {
        return { executablePath: pwPath, channelLabel: 'playwright-chromium' };
      }
    }
  } catch {
    // Ignore when playwright bundled browser is not downloaded
  }

  throw new Error(
    `No Chromium/Chrome/Edge executable found. Checked:\n- ${checked.join('\n- ')}`
  );
}

/**
 * Attaches separate uncaught pageerror and console.error trackers to a Playwright Page.
 */
export function attachErrorTrackers(page) {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', (err) => {
    pageErrors.push({
      message: err?.message || String(err),
      stack: err?.stack || '',
      url: page.url(),
      timestamp: Date.now(),
    });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({
        text: msg.text(),
        location: msg.location(),
        url: page.url(),
        timestamp: Date.now(),
      });
    }
  });

  return {
    pageErrors,
    consoleErrors,
    getErrors() {
      return {
        pageErrors: [...pageErrors],
        consoleErrors: [...consoleErrors],
      };
    },
    clearErrors() {
      pageErrors.length = 0;
      consoleErrors.length = 0;
    },
    assertNoErrors({ allowConsolePatterns = [] } = {}) {
      if (pageErrors.length > 0) {
        const formatted = pageErrors.map((e) => `[pageerror @ ${e.url}] ${e.message}`).join('\n');
        throw new Error(`Uncaught pageerror(s) detected:\n${formatted}`);
      }

      const unexpectedConsole = consoleErrors.filter((entry) => {
        return !allowConsolePatterns.some((pat) => {
          if (pat instanceof RegExp) return pat.test(entry.text);
          return entry.text.includes(String(pat));
        });
      });

      if (unexpectedConsole.length > 0) {
        const formatted = unexpectedConsole.map((e) => `[console.error @ ${e.url}] ${e.text}`).join('\n');
        throw new Error(`Unexpected console.error(s) detected:\n${formatted}`);
      }
    },
  };
}

/**
 * Launches headless Chromium/Chrome/Edge with managed tracked page helpers.
 */
export async function launchBrowser({
  headless = true,
  slowMo = 0,
  extraArgs = [],
} = {}) {
  const { executablePath, channelLabel } = resolveBrowserExecutable();

  const baseArgs = process.platform === 'win32'
    ? [
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ]
    : ['--no-first-run', '--disable-extensions'];

  if (process.env.E2E_NO_SANDBOX === '1') {
    baseArgs.push('--no-sandbox');
  }

  const browser = await chromium.launch({
    executablePath,
    headless,
    slowMo,
    args: [...baseArgs, ...extraArgs],
  });

  async function newTrackedPage(contextOptions = {}) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
      ...contextOptions,
    });
    const page = await context.newPage();
    const tracker = attachErrorTrackers(page);

    return {
      browser,
      context,
      page,
      ...tracker,
      async close() {
        try {
          await page.close();
        } catch {
          // ignore close errors during teardown
        }
        try {
          await context.close();
        } catch {
          // ignore close errors during teardown
        }
      },
    };
  }

  async function withPage(fn, contextOptions = {}) {
    const session = await newTrackedPage(contextOptions);
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  }

  return {
    browser,
    executablePath,
    channelLabel,
    newTrackedPage,
    withPage,
    async close() {
      await browser.close();
    },
  };
}

/**
 * Self-test verifying real headless Chromium launch on a local HTML+SVG page
 * with an inline script and zero uncaught pageerror/console.error.
 */
export async function runBrowserSelfTest() {
  const launcher = await launchBrowser();
  try {
    return await launcher.withPage(async (session) => {
      const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>MarketSync E2E Self-Test</title></head>
  <body>
    <main data-testid="app-shell" data-flavor="forever">
      <h1 id="title">MarketSync Browser Check</h1>
      <svg data-testid="price-history-chart" width="120" height="40">
        <polyline fill="none" stroke="#c89b3c" stroke-width="2" points="0,30 40,20 80,25 120,10" />
      </svg>
    </main>
    <script>
      window.__msReady = true;
      document.getElementById('title').setAttribute('data-hydrated', 'yes');
    </script>
  </body>
</html>`;
      await session.page.setContent(html, { waitUntil: 'domcontentloaded' });
      const hydrated = await session.page.locator('#title').getAttribute('data-hydrated');
      const svgPoints = await session.page.locator('[data-testid="price-history-chart"] polyline').getAttribute('points');
      const userAgent = await session.page.evaluate(() => navigator.userAgent);

      assert.equal(hydrated, 'yes');
      assert.ok(svgPoints && svgPoints.includes('120,10'));
      session.assertNoErrors();

      return {
        ok: true,
        executablePath: launcher.executablePath,
        channelLabel: launcher.channelLabel,
        userAgent,
      };
    });
  } finally {
    await launcher.close();
  }
}
