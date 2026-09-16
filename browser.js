/**
 * browser.js -- launches Chromium, wherever this happens to be running.
 *
 * Locally and in a container we use the full `playwright` package with its own
 * downloaded Chromium. That build is ~300MB and blows straight through Vercel's
 * function bundle limit, so on serverless we swap to `playwright-core` (~5MB)
 * driving `@sparticuz/chromium` (~50MB), a Chromium built for Lambda-style
 * environments.
 *
 * Both paths return a real Chromium. Nothing downstream needs to know which.
 *
 * TWO VERSION RULES, both learned the hard way:
 *
 *  1. `@sparticuz/chromium`'s major MUST match the Chromium that `playwright-core`
 *     expects. Pairing playwright-core 1.63 (wants Chromium 153) with
 *     @sparticuz/chromium 131 makes the browser start and die instantly, and the
 *     only symptom is "Target page, context or browser has been closed". The
 *     assertion below turns that into a message that says what is actually wrong.
 *
 *  2. The Docker tag must match the `playwright` version in package.json for the
 *     same reason.
 */

const fs = require('fs');
const path = require('path');

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];

/** Reads the Chromium major each side is built against, so a mismatch fails loudly. */
function checkChromiumVersions() {
  try {
    const sparticuz = JSON.parse(
      fs.readFileSync(require.resolve('@sparticuz/chromium/package.json'), 'utf8')
    ).version;
    const browsers = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(require.resolve('playwright-core')), '..', 'browsers.json'),
        'utf8'
      )
    );
    const expected = browsers.browsers.find((b) => b.name === 'chromium').browserVersion;

    const got = sparticuz.split('.')[0];
    const want = expected.split('.')[0];
    if (got !== want) {
      throw new Error(
        `Chromium version mismatch: @sparticuz/chromium is ${sparticuz} (Chromium ${got}) but ` +
          `playwright-core expects Chromium ${want}. Install @sparticuz/chromium@${want}.x — ` +
          'mismatched builds launch and exit immediately.'
      );
    }
  } catch (err) {
    if (/version mismatch/.test(err.message)) throw err;
    // Version files moved or unreadable: not worth failing the audit over.
  }
}

async function launchBrowser({ headless = true } = {}) {
  if (IS_SERVERLESS) {
    checkChromiumVersions();

    // @sparticuz/chromium ships as ESM, so it has to be imported rather than
    // required. Keeping it a separate module also stops bundlers inlining it --
    // it resolves its binary by relative path and breaks when bundled.
    const mod = await import('@sparticuz/chromium');
    const chromium = mod.default || mod;
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

module.exports = { launchBrowser, IS_SERVERLESS, checkChromiumVersions };
