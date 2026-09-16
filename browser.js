/**
 * browser.js -- launches Chromium, wherever this happens to be running.
 *
 * Locally and in a container we use the full `playwright` package with its own
 * downloaded Chromium. That build is ~300MB and blows straight through Vercel's
 * function bundle limit, so on serverless we swap to `playwright-core` (~5MB)
 * driving `@sparticuz/chromium` (~40MB), a Chromium built for Lambda-style
 * environments.
 *
 * Both paths return a real Chromium. Nothing downstream needs to know which.
 */

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

async function launchBrowser({ headless = true } = {}) {
  if (IS_SERVERLESS) {
    // Required as separate modules so a bundler never inlines the chromium
    // package -- it resolves its binary by relative path and breaks if bundled.
    const chromium = require('@sparticuz/chromium');
    const { chromium: playwright } = require('playwright-core');

    return playwright.launch({
      args: [...chromium.args, ...BASE_ARGS],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  const { chromium } = require('playwright');

  // Escape hatch for locked-down machines. Some Windows Application Control and
  // endpoint-security policies block Playwright's own unsigned
  // chrome-headless-shell.exe; pointing at an installed, signed browser gets
  // round it. Set PLAYWRIGHT_CHANNEL=chrome (or msedge) to use one.
  const channel = process.env.PLAYWRIGHT_CHANNEL;
  return chromium.launch({
    headless,
    args: BASE_ARGS,
    ...(channel ? { channel } : {}),
  });
}

module.exports = { launchBrowser, IS_SERVERLESS };
