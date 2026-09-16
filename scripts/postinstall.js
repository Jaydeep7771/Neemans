/**
 * Downloads the full Chromium build that the `playwright` package needs.
 *
 * Skipped on serverless platforms: there we drive `@sparticuz/chromium` instead,
 * and pulling a ~300MB browser would both waste build time and overflow the
 * function bundle limit.
 */
const { execSync } = require('child_process');

if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SKIP_PLAYWRIGHT_DOWNLOAD) {
  console.log('[postinstall] serverless build detected — skipping Chromium download.');
  process.exit(0);
}

try {
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch (err) {
  console.warn('[postinstall] Chromium download failed. Run "npx playwright install chromium" by hand.');
}
