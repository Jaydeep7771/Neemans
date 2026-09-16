/**
 * export-report.js -- run an audit and write it to disk as a submittable artifact.
 *
 *   node scripts/export-report.js [url] [--no-interactions]
 *
 * Produces, in sample-report/:
 *   audit-report.md    human-readable report, mirrors the dashboard
 *   audit-raw.json     the complete report object, including every intercepted request
 *
 * Written as a script rather than a copy-paste so the sample can be regenerated on demand.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { runAudit } = require('../server');

const OUT_DIR = path.join(__dirname, '..', 'sample-report');

const VERDICT_TEXT = {
  READY: 'CLEARED — ready for paid traffic',
  READY_WITH_FIXES: 'CONDITIONAL — launch with caution',
  NOT_READY: 'HOLD — not ready for paid traffic',
};

const CHECK_MARK = { pass: '[PASS]', fail: '[FAIL]', not_applicable: '[ N/A ]' };

const fence = (s) => `\`${s}\``;

/**
 * Tracking URLs run to ~1000 characters, which is unreadable in a document a person reads,
 * and the bulk of it is session noise. Keep the endpoint and the params that actually carry
 * diagnostic meaning (property/pixel id, event name, hit type), drop the rest.
 */
const DIAGNOSTIC_PARAMS = ['tid', 'id', 'en', 'ev', 't', 'ea', 'event', 'label', 'first_party_domain'];

function summariseUrl(url) {
  try {
    const u = new URL(url);
    const kept = DIAGNOSTIC_PARAMS.filter((k) => u.searchParams.has(k))
      .map((k) => `${k}=${u.searchParams.get(k)}`)
      .join('&');
    const dropped = [...u.searchParams.keys()].length - DIAGNOSTIC_PARAMS.filter((k) => u.searchParams.has(k)).length;
    return `${u.origin}${u.pathname}${kept ? `?${kept}` : ''}${dropped > 0 ? ` (+${dropped} params)` : ''}`;
  } catch (_) {
    return url.slice(0, 200);
  }
}

function table(headers, rows) {
  if (!rows.length) return '_None._\n';
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n') + '\n';
}

function renderMarkdown(report) {
  const L = [];
  const p = (s = '') => L.push(s);

  const counts = { High: 0, Medium: 0, Low: 0 };
  report.issues.forEach((i) => {
    counts[i.severity] = (counts[i.severity] || 0) + 1;
  });
  const measured = report.issues.filter((i) => i.source === 'deterministic');
  const read = report.issues.filter((i) => i.source === 'gemini');

  /* ---- header ---- */
  p('# Landing Page Pre-Flight Report');
  p();
  p(`**${VERDICT_TEXT[report.verdict] || report.verdict}** · Readiness **${report.readinessScore}/100**`);
  p();
  p(`> ${report.headline || ''}`);
  p();
  p(table(
    ['Field', 'Value'],
    [
      ['Target', report.targetUrl],
      ['Audited', new Date(report.startedAt).toUTCString()],
      ['Session length', `${(report.durationMs / 1000).toFixed(1)}s (real headless Chromium)`],
      ['Page response', `HTTP ${report.navigation.status} — "${report.navigation.title || ''}"`],
      ['Add-to-cart simulated', report.navigation.addToCart?.clicked ? 'yes' : 'no'],
      ['Tracking requests intercepted', report.summary.totalTrackingRequests],
      ['Tracking events parsed', report.summary.totalEvents],
      ['Vendors detected', report.summary.vendorsDetected],
      ['Findings', `${counts.High} high · ${counts.Medium} medium · ${counts.Low} low`],
      ['Analysis model', report.aiAvailable ? process.env.GEMINI_MODEL || 'gemini' : 'unavailable (deterministic only)'],
      ['Run ID', report.runId || '—'],
    ]
  ));

  /* ---- provenance key ---- */
  p('## How to read this report');
  p();
  p(`Every finding is attributed. **MEASURED** (${measured.length}) comes from a fixed rule applied to the`);
  p('network traffic captured in the browser session — identical on every run of unchanged code.');
  p(`**READ** (${read.length}) is Gemini interpreting those measurements commercially. It assigns severity`);
  p('and business impact; it never decides what fired.');
  p();

  /* ---- summary ---- */
  if (report.executiveSummary) {
    p('## Executive summary');
    p();
    p('_READ — Gemini_');
    p();
    p(report.executiveSummary);
    p();
  }

  /* ---- checklist ---- */
  if (report.checks?.length) {
    const passed = report.checks.filter((c) => c.status === 'pass').length;
    p(`## Pre-flight checklist — ${passed}/${report.checks.length} pass`);
    p();
    p('_MEASURED. Each check states the exact deterministic rule it applies._');
    p();
    for (const c of report.checks) {
      p(`### ${CHECK_MARK[c.status] || '[ ? ]'} ${c.label}`);
      p();
      p(`- **Asks:** ${c.question}`);
      p(`- **Rule:** ${c.method}`);
      p(`- **Result:** ${c.detail || '—'}`);
      p();
    }
  }

  /* ---- next steps ---- */
  if (report.recommendedNextSteps?.length) {
    p('## Recommended actions, most urgent first');
    p();
    p('_READ — Gemini_');
    p();
    report.recommendedNextSteps.forEach((s, i) => p(`${i + 1}. ${s}`));
    p();
  }

  /* ---- findings ---- */
  p(`## Findings — ${report.issues.length}`);
  p();
  const order = { High: 0, Medium: 1, Low: 2 };
  const sorted = [...report.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  for (const i of sorted) {
    p(`### ${i.severity} · ${i.source === 'gemini' ? 'READ' : 'MEASURED'} — ${i.title}`);
    p();
    if (i.businessRisk) p(`**Business risk.** ${i.businessRisk}`);
    if (i.detail) p(`${i.businessRisk ? '**Observed.** ' : ''}${i.detail}`);
    if (i.affectedMetric) p(`**Metric at risk.** ${i.affectedMetric}`);
    if (i.recommendedFix) p(`**Fix.** ${i.recommendedFix}`);
    if (i.evidence?.length) {
      p();
      p('Requests captured (abridged to diagnostic params — full URLs in `audit-raw.json`):');
      p();
      i.evidence.forEach((e) => p(`- ${fence(summariseUrl(e))}`));
    }
    p();
  }

  /* ---- vendors ---- */
  p('## Tags detected on the page');
  p();
  p('_MEASURED — observed transmitting in a real browser session._');
  p();
  p(table(
    ['Vendor', 'Hits', 'Account IDs', 'Events observed'],
    report.vendorInventory.map((v) => [
      v.label,
      v.hits,
      v.accountIds.length ? v.accountIds.join(', ') : '—',
      v.events.length ? v.events.join(', ') : '—',
    ])
  ));

  /* ---- taxonomy ---- */
  if (report.eventTaxonomy?.length) {
    p('## Event naming review');
    p();
    p('_Whether a name is standard is MEASURED; what it means and what it should be is READ._');
    p();
    p(table(
      ['Event sent', 'Platform', 'Category', 'What it means', 'Should be called'],
      report.eventTaxonomy.map((t) => [
        fence(t.observedName),
        t.vendor,
        t.category,
        t.businessMeaning,
        t.suggestedName !== t.observedName ? fence(t.suggestedName) : '— no change —',
      ])
    ));
  }

  /* ---- duplicates ---- */
  p('## Duplicate events');
  p();
  p('_MEASURED — identical payload fingerprint seen more than once._');
  p();
  p(table(
    ['Vendor', 'Event', 'Times fired', 'Fired at', 'Phase', 'Conversion?', 'Fingerprint'],
    (report.duplicates || []).map((d) => [
      d.vendorLabel,
      fence(d.eventName),
      d.count,
      d.timestampsMs.map((t) => `+${t}ms`).join(', '),
      d.phases.join(', '),
      d.isConversion ? 'yes' : 'no',
      fence(d.fingerprint),
    ])
  ));

  /* ---- timeline ---- */
  p('## What the browser did');
  p();
  p(table(
    ['At', 'Step', 'Detail'],
    (report.timeline || []).map((t) => [`+${t.tMs}ms`, t.label, t.detail])
  ));

  /* ---- event log ---- */
  const events = (report.networkLog || []).filter((h) => h.eventName);
  p(`## Full event log — ${events.length} events`);
  p();
  p(table(
    ['At', 'Phase', 'Vendor', 'Event', 'HTTP', 'Account'],
    events.map((e) => [
      `+${e.tMs}ms`,
      e.phase,
      e.vendorLabel,
      fence(e.eventName),
      e.failure || e.status || '—',
      e.accountId || '—',
    ])
  ));

  if (report.pageErrors?.length) {
    p('## JavaScript errors on the page');
    p();
    report.pageErrors.forEach((e) => p(`- ${fence(e)}`));
    p();
  }

  p('---');
  p();
  p(
    `Generated by the Landing Page Pre-Flight Auditor. ${report.checks?.length || 0} deterministic ` +
    `checks over ${report.summary.totalTrackingRequests} intercepted requests, interpreted by Gemini. ` +
    'Captured with a real Chromium session, not static HTML inspection.'
  );

  return L.join('\n');
}

(async () => {
  const args = process.argv.slice(2);
  const url = args.find((a) => a.startsWith('http')) || process.env.DEFAULT_TARGET_URL;
  const interactions = !args.includes('--no-interactions');

  if (!url) {
    console.error('No URL given and DEFAULT_TARGET_URL is not set.');
    process.exit(1);
  }

  console.log(`Auditing ${url} (interactions: ${interactions})...`);
  const report = await runAudit(url, { interactions });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = path.join(OUT_DIR, 'audit-report.md');
  const json = path.join(OUT_DIR, 'audit-raw.json');

  fs.writeFileSync(md, renderMarkdown(report), 'utf8');
  fs.writeFileSync(json, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\n${report.verdict} · ${report.readinessScore}/100 · AI ${report.aiAvailable ? 'on' : 'off'}`);
  console.log(`  ${md}`);
  console.log(`  ${json}`);
  process.exit(0);
})().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
