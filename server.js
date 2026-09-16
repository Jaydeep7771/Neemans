/**
 * Landing Page Pre-Flight Auditor -- Express API + Playwright network interception.
 *
 *   POST /api/audit   { url, interactions }  -> runs a real browser session, returns the report
 *   GET  /api/audits                         -> recent runs logged in Supabase
 *   GET  /api/audits/:id                     -> one stored run
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { launchBrowser } = require('./browser');

const {
  REQUIRED_VENDOR_IDS,
  VENDORS,
  VOLATILE_PARAMS,
  classifyVendor,
  isConversionEvent,
  isStandardEvent,
} = require('./trackingTaxonomy');
const { analyseAuditFindings } = require('./geminiService');
const { logAuditRun, listAuditRuns, getAuditRun } = require('./supabaseClient');

const PORT = process.env.PORT || 8787;
const DEFAULT_TARGET_URL =
  process.env.DEFAULT_TARGET_URL || 'https://neemans.com/products/the-luxe-loafers-tan';
const HEADLESS = process.env.HEADLESS !== 'false';
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS || 60000);

/* ------------------------------------------------------------------ *
 * Payload parsing
 * ------------------------------------------------------------------ */

function flattenJson(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix || 'value'] = String(obj);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flattenJson(v, key, out);
    else out[key] = v === undefined ? '' : String(v);
  }
  return out;
}

/** Batched beacons can carry hundreds of rows; keep the log readable. */
const MAX_ROWS_PER_REQUEST = 20;

function parseBodyParams(postData, contentType = '') {
  if (!postData) return [];
  const trimmed = postData.trim();

  // JSON bodies (Segment, Shopify monorail, TikTok).
  if (/^[[{]/.test(trimmed)) {
    try {
      const json = JSON.parse(trimmed);
      const rows = Array.isArray(json) ? json : [json];
      return rows.slice(0, MAX_ROWS_PER_REQUEST).map((r) => flattenJson(r));
    } catch (_) {
      /* fall through to urlencoded handling */
    }
  }
  if (/json/i.test(contentType)) return [];

  // GA4 sends newline-delimited batches of urlencoded event rows.
  return trimmed
    .split('\n')
    .filter(Boolean)
    .slice(0, MAX_ROWS_PER_REQUEST)
    .map((line) => Object.fromEntries(new URLSearchParams(line)));
}

/** Pull the vendor-specific event name out of a params bag. */
function extractEventName(vendorId, params) {
  switch (vendorId) {
    case 'ga4':
      return params.en || params['events.0.name'] || null;
    case 'ua':
      return params.ea || params.t || null;
    case 'meta_pixel':
      return params.ev || null;
    case 'tiktok':
      return params.event || params['context.event'] || params.event_name || null;
    case 'pinterest':
      return params.event || params.ed || null;
    case 'snap':
      return params.ev || params.event_type || null;
    case 'bing':
      return params.ea || params.evt || null;
    case 'klaviyo':
      return params.event || null;
    case 'segment':
      return params.event || params.type || null;
    case 'shopify':
      return params.event_name || params.schema_id || null;
    case 'google_ads':
      return params.label ? `conversion:${params.label}` : 'conversion';
    default:
      return params.event || params.en || params.ev || null;
  }
}

/** Account / container id, so we can spot two properties fighting each other. */
function extractAccountId(vendorId, params, url) {
  if (params.tid) return params.tid;
  if (params.id) return params.id;
  if (params.sid) return params.sid;
  const gtm = url.match(/[?&]id=([^&]+)/);
  return gtm ? gtm[1] : null;
}

/** Stable fingerprint: same vendor + same event + same meaningful payload. */
function fingerprint(vendorId, eventName, params) {
  const stable = Object.entries(params)
    .filter(([k]) => !VOLATILE_PARAMS.has(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto
    .createHash('sha1')
    .update(`${vendorId}|${eventName || 'unnamed'}|${stable}`)
    .digest('hex')
    .slice(0, 16);
}

function trimParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = typeof v === 'string' && v.length > 240 ? `${v.slice(0, 240)}...` : v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Playwright session
 * ------------------------------------------------------------------ */

const CONSENT_SELECTORS = [
  '#onetrust-accept-btn-handler',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("I Agree")',
  'button:has-text("Got it")',
  '[aria-label="Accept cookies"]',
];

const ATC_SELECTORS = [
  'button[name="add"]',
  'button#AddToCart',
  'form[action*="/cart/add"] button[type="submit"]',
  '[data-testid*="add-to-cart" i]',
  'button:has-text("Add to cart")',
  'button:has-text("Add to Cart")',
  'button:has-text("Add to bag")',
  'a:has-text("Add to cart")',
  'button:has-text("Buy now")',
];

async function dismissConsent(page, note) {
  for (const sel of CONSENT_SELECTORS) {
    const el = page.locator(sel).first();
    const exists = await el.count().then((c) => c > 0).catch(() => false);
    if (!exists) continue;
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 3000 }).catch(() => {});
    note('consent', `Dismissed consent banner via ${sel}`);
    await page.waitForTimeout(1500);
    return;
  }
}

async function simulateScroll(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
  });
}

async function clickAddToCart(page) {
  // Some PDPs require a size/variant selection before the CTA is enabled.
  for (const sel of ['[data-variant-option]', '.swatch input + label', 'fieldset label']) {
    const opt = page.locator(sel).first();
    const exists = await opt.count().then((c) => c > 0).catch(() => false);
    if (exists) {
      await opt.click({ timeout: 2500 }).catch(() => {});
      break;
    }
  }

  let lastError = null;
  for (const sel of ATC_SELECTORS) {
    const btn = page.locator(sel).first();
    const exists = await btn.count().then((c) => c > 0).catch(() => false);
    if (!exists) continue;
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.scrollIntoViewIfNeeded().catch(() => {});

    // Normal click first; sticky headers and overlays are common on PDPs, so
    // fall back to a forced click before giving up on this selector.
    for (const opts of [{ timeout: 5000 }, { timeout: 5000, force: true }]) {
      try {
        await btn.click(opts);
        return {
          clicked: true,
          selector: sel,
          detail: `Clicked add-to-cart CTA (${sel})${opts.force ? ' using a forced click' : ''}`,
        };
      } catch (err) {
        lastError = String(err).slice(0, 160);
      }
    }
  }
  return {
    clicked: false,
    selector: null,
    detail: lastError
      ? `An add-to-cart CTA was found but every click attempt was blocked: ${lastError}`
      : 'No add-to-cart CTA could be located on the page',
  };
}

async function captureSession(targetUrl, { interactions = true } = {}) {
  const browser = await launchBrowser({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-IN',
  });

  const hits = [];
  const consoleErrors = [];
  const pageErrors = [];
  const timeline = [];
  const byUrl = new Map();
  const startedAt = Date.now();

  let currentPhase = 'load';
  const note = (label, detail) => timeline.push({ tMs: Date.now() - startedAt, label, detail });

  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 500)));

  page.on('request', (request) => {
    const url = request.url();
    const vendor = classifyVendor(url);
    if (!vendor) return;

    const resourceType = request.resourceType();
    const isBeacon = ['xhr', 'fetch', 'image', 'ping', 'other'].includes(resourceType);

    let query = {};
    let host = '';
    try {
      const parsed = new URL(url);
      query = Object.fromEntries(parsed.searchParams);
      host = parsed.host;
    } catch (_) {
      /* ignore malformed urls */
    }

    const bodyRows = parseBodyParams(request.postData(), request.headers()['content-type'] || '');
    const rows = bodyRows.length ? bodyRows.map((b) => ({ ...query, ...b })) : [query];

    rows.forEach((params, idx) => {
      const eventName = extractEventName(vendor.id, params);
      const hit = {
        id: `${hits.length}-${idx}`,
        tMs: Date.now() - startedAt,
        phase: currentPhase,
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        family: vendor.family,
        resourceType,
        isBeacon,
        method: request.method(),
        url: url.slice(0, 900),
        host,
        accountId: extractAccountId(vendor.id, params, url),
        eventName,
        isConversion: isConversionEvent(eventName),
        isStandardEvent: isStandardEvent(vendor.id, eventName),
        params: trimParams(params),
        fingerprint: fingerprint(vendor.id, eventName, params),
        status: null,
        statusText: null,
        failure: null,
      };
      hits.push(hit);
      if (!byUrl.has(url)) byUrl.set(url, []);
      byUrl.get(url).push(hit);
    });
  });

  page.on('response', (response) => {
    const list = byUrl.get(response.url());
    if (!list) return;
    list.forEach((h) => {
      if (h.status === null) {
        h.status = response.status();
        h.statusText = response.statusText();
      }
    });
  });

  page.on('requestfailed', (request) => {
    const list = byUrl.get(request.url());
    if (!list) return;
    const failure = (request.failure() && request.failure().errorText) || 'request failed';
    list.forEach((h) => {
      if (h.failure === null) h.failure = failure;
    });
  });

  let navigation = { ok: false, status: null, finalUrl: null, title: null, error: null };

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT,
    });
    navigation = {
      ok: !!response && response.ok(),
      status: response ? response.status() : null,
      finalUrl: page.url(),
      title: await page.title().catch(() => null),
      error: null,
    };
    note('navigation', `HTTP ${navigation.status} -> ${navigation.finalUrl}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    if (interactions) {
      currentPhase = 'consent';
      await dismissConsent(page, note);

      currentPhase = 'scroll';
      await simulateScroll(page);
      note('scroll', 'Scrolled through the full page and back to top');
      await page.waitForTimeout(2000);

      currentPhase = 'add_to_cart';
      const atc = await clickAddToCart(page);
      note('add_to_cart', atc.detail);
      await page.waitForTimeout(4000);
      navigation.addToCart = atc;
    }

    currentPhase = 'settle';
    await page.waitForTimeout(1500);
  } catch (err) {
    navigation.error = String(err).slice(0, 400);
    note('error', navigation.error);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  return {
    hits,
    timeline,
    navigation,
    consoleErrors: consoleErrors.slice(0, 40),
    pageErrors: pageErrors.slice(0, 20),
    durationMs: Date.now() - startedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic checks -- no model involved, pure pattern matching
 * ------------------------------------------------------------------ */

function sameOrigin(a, b) {
  try {
    return new URL(a).host.replace(/^www\./, '') === new URL(b).host.replace(/^www\./, '');
  } catch (_) {
    return true;
  }
}

/**
 * Every deterministic rule, stated explicitly.
 *
 * `question` is what a marketer is actually asking. `method` is the exact rule the code
 * applies -- no model, no heuristic, same answer on every run for the same input. Both are
 * surfaced in the report so a reader can audit the auditor and see which findings are
 * measured fact versus model interpretation.
 */
const CHECK_DEFINITIONS = [
  {
    id: 'page_health',
    label: 'The page actually loads',
    question: 'Does the ad click land somewhere that works?',
    method:
      'Asserts the navigation response is HTTP 2xx and that the final URL is on the same host as the requested URL (after stripping "www.").',
  },
  {
    id: 'tag_presence',
    label: 'Your tags are installed and firing',
    question: 'Are the pixels really there, and are they running?',
    method:
      'Matches every request URL against a table of known vendor endpoints, then asserts GA4 and Meta Pixel each produced at least one request.',
  },
  {
    id: 'duplicate_events',
    label: 'Nothing fires twice',
    question: 'Is anything getting counted more than once?',
    method:
      'SHA-1 fingerprint over vendor + event name + payload, with volatile params (_p, seq, sid, cache-busters, timestamps) removed. Two hits sharing a fingerprint are a genuine double-fire, not two legitimate events.',
  },
  {
    id: 'tracking_http',
    label: 'The data actually arrives',
    question: 'Did the tracking reach Google and Meta, or die on the way?',
    method:
      'Records the HTTP status of each tracking request and flags any 4xx/5xx or transport-level failure (timeout, aborted, DNS).',
  },
  {
    id: 'account_consistency',
    label: 'One account per platform',
    question: 'Is your data being split across duplicate accounts?',
    method:
      'Extracts the account identifier (tid / id / sid) from every hit and asserts each vendor resolves to exactly one distinct ID.',
  },
  {
    id: 'conversion_coverage',
    label: 'Add to cart gets tracked',
    question: 'When someone shows they want to buy, do the ad platforms hear about it?',
    method:
      'Tags every request with the interaction phase it fired in, then asserts that a conversion-intent event reached each installed ad platform during the add_to_cart phase.',
  },
  {
    id: 'event_naming',
    label: 'Event names make sense to the platforms',
    question: "Can Google and Meta understand what you're sending them?",
    method:
      "Set membership against the 18 Meta standard events and the 23 GA4 recommended events held in trackingTaxonomy.js. Anything outside them is a custom name.",
  },
  {
    id: 'deprecated_tags',
    label: 'Nothing dead is still running',
    question: 'Are you still sending data to something that shut down?',
    method: 'Flags hits to the Universal Analytics collect endpoint, which no longer processes data.',
  },
];

function runDeterministicChecks(session, targetUrl) {
  const { hits, navigation } = session;
  const beacons = hits.filter((h) => h.eventName || h.isBeacon);
  const issues = [];

  /* Every check starts as passing; a failure downgrades it and links the issues it produced. */
  const checks = new Map(
    CHECK_DEFINITIONS.map((d) => [d.id, { ...d, status: 'pass', detail: '', issueIds: [] }])
  );
  const setCheck = (checkId, status, detail) => {
    const c = checks.get(checkId);
    if (!c) return;
    c.status = status;
    c.detail = detail;
  };
  const addIssue = (checkId, issue) => {
    const id = `det-${issues.length + 1}`;
    issues.push({ id, source: 'deterministic', checkId, ...issue });
    const c = checks.get(checkId);
    if (c) {
      c.issueIds.push(id);
      if (c.status !== 'not_applicable') c.status = 'fail';
    }
    return id;
  };

  /* --- vendor inventory --- */
  const vendorsSeen = new Map();
  for (const h of hits) {
    if (!vendorsSeen.has(h.vendorId)) {
      vendorsSeen.set(h.vendorId, {
        vendorId: h.vendorId,
        label: h.vendorLabel,
        family: h.family,
        hits: 0,
        accountIds: new Set(),
        events: new Set(),
      });
    }
    const v = vendorsSeen.get(h.vendorId);
    v.hits += 1;
    if (h.accountId) v.accountIds.add(h.accountId);
    if (h.eventName) v.events.add(h.eventName);
  }
  const vendorInventory = [...vendorsSeen.values()].map((v) => ({
    ...v,
    accountIds: [...v.accountIds],
    events: [...v.events],
  }));

  /* --- 1. missing standard tags --- */
  for (const required of REQUIRED_VENDOR_IDS) {
    if (!vendorsSeen.has(required)) {
      const label = VENDORS.find((v) => v.id === required).label;
      addIssue('tag_presence', {
        type: 'missing_tag',
        severity: 'High',
        title: `${label} never fired`,
        detail: `No ${label} network request was observed across page load, scroll and add-to-cart.`,
        evidence: [],
      });
    }
  }

  if (checks.get('tag_presence').status === 'pass') {
    setCheck(
      'tag_presence',
      'pass',
      `All required tags fired: ${REQUIRED_VENDOR_IDS.map((id) => vendorsSeen.get(id).label).join(', ')}. ${vendorInventory.length} vendor(s) detected in total.`
    );
  }

  /* --- 2. duplicate firing of the same event payload --- */
  const byFingerprint = new Map();
  for (const h of beacons) {
    if (!h.eventName) continue;
    if (!byFingerprint.has(h.fingerprint)) byFingerprint.set(h.fingerprint, []);
    byFingerprint.get(h.fingerprint).push(h);
  }
  const duplicates = [];
  for (const [fp, group] of byFingerprint) {
    if (group.length < 2) continue;
    const phases = [...new Set(group.map((g) => g.phase))];
    duplicates.push({
      fingerprint: fp,
      vendorId: group[0].vendorId,
      vendorLabel: group[0].vendorLabel,
      eventName: group[0].eventName,
      count: group.length,
      isConversion: group[0].isConversion,
      timestampsMs: group.map((g) => g.tMs),
      phases,
      sampleUrl: group[0].url,
    });
    addIssue('duplicate_events', {
      type: 'duplicate_event',
      severity: group[0].isConversion ? 'High' : 'Medium',
      title: `${group[0].vendorLabel} "${group[0].eventName}" fired ${group.length}x with an identical payload`,
      detail: `Identical payload fingerprint (${fp}) sent ${group.length} times at +${group
        .map((g) => `${g.tMs}ms`)
        .join(', +')} during phase(s): ${phases.join(', ')}.`,
      evidence: group.slice(0, 3).map((g) => g.url),
    });
  }

  if (!duplicates.length) {
    setCheck(
      'duplicate_events',
      'pass',
      `${beacons.filter((h) => h.eventName).length} event(s) fingerprinted; every payload was unique.`
    );
  }

  /* --- 3. HTTP 4xx/5xx and transport failures on tracking requests --- */
  const failedHits = hits.filter((h) => (h.status && h.status >= 400) || h.failure);
  const failureGroups = new Map();
  for (const h of failedHits) {
    const key = `${h.vendorId}|${h.status || h.failure}`;
    if (!failureGroups.has(key)) failureGroups.set(key, []);
    failureGroups.get(key).push(h);
  }
  for (const group of failureGroups.values()) {
    const first = group[0];
    addIssue('tracking_http', {
      type: 'tracking_http_error',
      severity: first.failure || first.status >= 500 ? 'High' : 'Medium',
      title: `${first.vendorLabel} request ${
        first.failure ? 'failed' : `returned HTTP ${first.status}`
      }`,
      detail: `${group.length} ${first.vendorLabel} request(s) ${
        first.failure
          ? `failed at the transport layer (${first.failure})`
          : `returned HTTP ${first.status} ${first.statusText || ''}`
      }. Affected event(s): ${[...new Set(group.map((g) => g.eventName || 'n/a'))].join(', ')}.`,
      evidence: group.slice(0, 3).map((g) => g.url),
    });
  }

  if (!failedHits.length) {
    setCheck(
      'tracking_http',
      'pass',
      `All ${hits.length} tracking request(s) were accepted by their platform.`
    );
  }

  /* --- 4. multiple property / pixel ids per vendor --- */
  for (const v of vendorInventory) {
    if (v.accountIds.length > 1) {
      addIssue('account_consistency', {
        type: 'multiple_accounts',
        severity: 'Medium',
        title: `${v.label} is reporting to ${v.accountIds.length} different IDs`,
        detail: `IDs observed: ${v.accountIds.join(', ')}.`,
        evidence: [],
      });
    }
  }

  if (checks.get('account_consistency').status === 'pass') {
    setCheck(
      'account_consistency',
      'pass',
      vendorInventory.length
        ? 'Every vendor resolved to a single account ID.'
        : 'No vendors detected, so there were no account IDs to compare.'
    );
  }

  /* --- 5. conversion coverage on the simulated add-to-cart --- */
  const conversionHits = beacons.filter((h) => h.isConversion);
  const atc = navigation.addToCart || { clicked: false, detail: 'Interactions were skipped for this run.' };
  if (atc.clicked) {
    const atcEvents = beacons.filter((h) => h.phase === 'add_to_cart' && h.isConversion);
    if (atcEvents.length === 0) {
      addIssue('conversion_coverage', {
        type: 'missing_conversion_event',
        severity: 'High',
        title: 'Add-to-cart click produced no conversion event',
        detail:
          'The add-to-cart CTA was clicked but no AddToCart/add_to_cart beacon was sent to any ad or analytics platform.',
        evidence: [],
      });
    } else {
      for (const required of REQUIRED_VENDOR_IDS) {
        if (vendorsSeen.has(required) && !atcEvents.some((e) => e.vendorId === required)) {
          const label = VENDORS.find((v) => v.id === required).label;
          addIssue('conversion_coverage', {
            type: 'missing_conversion_event',
            severity: 'High',
            title: `${label} did not record the add-to-cart`,
            detail: `${label} is installed and firing other events, but no add-to-cart conversion reached it after the CTA click.`,
            evidence: [],
          });
        }
      }
    }
    if (checks.get('conversion_coverage').status === 'pass') {
      setCheck(
        'conversion_coverage',
        'pass',
        `Add-to-cart click produced ${atcEvents.length} conversion event(s): ${[
          ...new Set(atcEvents.map((e) => `${e.vendorLabel}/${e.eventName}`)),
        ].join(', ')}.`
      );
    }
  } else {
    // The CTA never got clicked, so there is nothing to assert either way.
    checks.get('conversion_coverage').status = 'not_applicable';
    addIssue('conversion_coverage', {
      type: 'interaction_not_testable',
      severity: 'Low',
      title: 'Add-to-cart could not be simulated',
      detail: atc.detail,
      evidence: [],
    });
  }

  /* --- 6. non-standard / custom event names (categorised later by Gemini) --- */
  const customEvents = [
    ...new Set(
      beacons
        .filter(
          (h) =>
            h.eventName &&
            !h.isStandardEvent &&
            ['ga4', 'ua', 'meta_pixel'].includes(h.vendorId)
        )
        .map((h) => `${h.vendorLabel}:${h.eventName}`)
    ),
  ];
  if (customEvents.length) {
    addIssue('event_naming', {
      type: 'non_standard_events',
      severity: 'Medium',
      title: `${customEvents.length} non-standard event name(s) in use`,
      detail: `Events outside the platform's standard vocabulary: ${customEvents.join(', ')}.`,
      evidence: [],
    });
  }

  if (!customEvents.length) {
    setCheck(
      'event_naming',
      'pass',
      'Every event name on GA4 and Meta matched the platform vocabulary.'
    );
  }

  /* --- 7. deprecated stack --- */
  if (vendorsSeen.has('ua')) {
    addIssue('deprecated_tags', {
      type: 'deprecated_tag',
      severity: 'Low',
      title: 'Universal Analytics traffic detected',
      detail: 'Universal Analytics has been sunset and no longer processes hits.',
      evidence: [],
    });
  }

  if (!vendorsSeen.has('ua')) {
    setCheck('deprecated_tags', 'pass', 'No Universal Analytics traffic observed.');
  }

  /* --- 8. the page itself --- */
  if (!navigation.ok) {
    addIssue('page_health', {
      type: 'page_load',
      severity: 'High',
      title: `Landing page returned HTTP ${navigation.status || 'error'}`,
      detail: navigation.error || `The page responded with HTTP ${navigation.status}.`,
      evidence: [navigation.finalUrl || targetUrl],
    });
  }
  if (navigation.finalUrl && !sameOrigin(navigation.finalUrl, targetUrl)) {
    addIssue('page_health', {
      type: 'redirect',
      severity: 'Medium',
      title: 'Landing page redirected to a different origin',
      detail: `Requested ${targetUrl} but landed on ${navigation.finalUrl}. Ad platforms compare the destination URL against the display URL.`,
      evidence: [navigation.finalUrl],
    });
  }

  if (checks.get('page_health').status === 'pass') {
    setCheck(
      'page_health',
      'pass',
      `HTTP ${navigation.status} on the requested origin${navigation.title ? ` -- "${navigation.title}"` : ''}.`
    );
  }

  const summary = {
    totalTrackingRequests: hits.length,
    totalEvents: beacons.filter((h) => h.eventName).length,
    vendorsDetected: vendorInventory.length,
    duplicateGroups: duplicates.length,
    duplicateHits: duplicates.reduce((n, d) => n + d.count - 1, 0),
    failedTrackingRequests: failedHits.length,
    conversionEvents: conversionHits.length,
    customEventNames: customEvents.length,
    sessionDurationMs: session.durationMs,
  };

  // A failing check reports the findings it produced, so the checklist is readable on its own.
  for (const c of checks.values()) {
    if (c.status === 'fail' && !c.detail) {
      c.detail = c.issueIds
        .map((id) => issues.find((i) => i.id === id))
        .filter(Boolean)
        .map((i) => `${i.severity}: ${i.title}`)
        .join(' · ');
    }
  }

  return {
    issues,
    checks: [...checks.values()],
    vendorInventory,
    duplicates,
    failedHits,
    customEvents,
    summary,
  };
}

/* ------------------------------------------------------------------ *
 * Scoring + verdict
 * ------------------------------------------------------------------ */

const SEVERITY_WEIGHT = { High: 25, Medium: 10, Low: 3 };

function scoreAudit(issues) {
  const raw = issues.reduce((acc, i) => acc - (SEVERITY_WEIGHT[i.severity] || 5), 100);
  const readinessScore = Math.max(0, Math.min(100, raw));
  const highCount = issues.filter((i) => i.severity === 'High').length;
  let verdict = 'READY';
  if (highCount > 0 || readinessScore < 55) verdict = 'NOT_READY';
  else if (readinessScore < 80) verdict = 'READY_WITH_FIXES';
  return { readinessScore, verdict };
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

async function runAudit(targetUrl, options = {}) {
  const startedAt = new Date().toISOString();
  const session = await captureSession(targetUrl, options);
  const deterministic = runDeterministicChecks(session, targetUrl);

  const ai = await analyseAuditFindings({
    targetUrl,
    navigation: session.navigation,
    summary: deterministic.summary,
    vendorInventory: deterministic.vendorInventory,
    duplicates: deterministic.duplicates,
    deterministicIssues: deterministic.issues,
    customEvents: deterministic.customEvents,
    eventLog: session.hits
      .filter((h) => h.eventName)
      .slice(0, 120)
      .map((h) => ({
        tMs: h.tMs,
        phase: h.phase,
        vendor: h.vendorLabel,
        event: h.eventName,
        status: h.status,
        accountId: h.accountId,
        isConversion: h.isConversion,
        isStandardEvent: h.isStandardEvent,
      })),
    failedRequests: deterministic.failedHits.slice(0, 20).map((h) => ({
      vendor: h.vendorLabel,
      event: h.eventName,
      status: h.status,
      failure: h.failure,
      url: h.url,
    })),
  });

  const allIssues = [...deterministic.issues, ...ai.issues];
  const { readinessScore, verdict } = scoreAudit(allIssues);

  const report = {
    targetUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: session.durationMs,
    navigation: session.navigation,
    verdict,
    readinessScore,
    summary: deterministic.summary,
    headline: ai.headline,
    executiveSummary: ai.executiveSummary,
    aiAvailable: ai.available,
    aiError: ai.error,
    eventTaxonomy: ai.eventTaxonomy,
    recommendedNextSteps: ai.recommendedNextSteps,
    issues: allIssues,
    checks: deterministic.checks,
    vendorInventory: deterministic.vendorInventory,
    duplicates: deterministic.duplicates,
    timeline: session.timeline,
    consoleErrors: session.consoleErrors,
    pageErrors: session.pageErrors,
    networkLog: session.hits,
  };

  const logged = await logAuditRun(report);
  report.runId = logged.id;
  report.persisted = logged.persisted;
  report.persistError = logged.error;
  return report;
}

/* ------------------------------------------------------------------ *
 * HTTP layer
 * ------------------------------------------------------------------ */

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    defaultTargetUrl: DEFAULT_TARGET_URL,
    gemini: !!process.env.GEMINI_API_KEY,
    supabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
});

app.post('/api/audit', async (req, res) => {
  const targetUrl = ((req.body && req.body.url) || DEFAULT_TARGET_URL).trim();
  const interactions = !(req.body && req.body.interactions === false);

  try {
    const parsed = new URL(targetUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
  } catch (_) {
    return res.status(400).json({ error: 'Provide a valid http(s) URL.' });
  }

  try {
    console.log(`[audit] starting ${targetUrl}`);
    const report = await runAudit(targetUrl, { interactions });
    console.log(
      `[audit] done ${targetUrl} -> ${report.verdict} (${report.readinessScore}) in ${report.durationMs}ms`
    );
    res.json(report);
  } catch (err) {
    console.error('[audit] failed', err);
    res.status(500).json({ error: 'Audit failed', detail: String(err).slice(0, 500) });
  }
});

app.get('/api/audits', async (req, res) => {
  const result = await listAuditRuns(Number(req.query.limit) || 20);
  if (result.error) return res.status(503).json({ error: result.error });
  res.json(result.rows);
});

app.get('/api/audits/:id', async (req, res) => {
  const result = await getAuditRun(req.params.id);
  if (result.error) return res.status(404).json({ error: result.error });
  res.json(result.row);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pre-Flight Auditor API listening on http://localhost:${PORT}`);
    console.log(`Default target: ${DEFAULT_TARGET_URL}`);
  });
}

module.exports = {
  app,
  runAudit,
  runDeterministicChecks,
  captureSession,
  scoreAudit,
  fingerprint,
  parseBodyParams,
  extractEventName,
};
