# Build prompt — Landing Page Pre-Flight Auditor

Paste everything below the line into a fresh session in an empty folder.

---

You are a senior full-stack engineer. Build a **Landing Page Pre-Flight Auditor**: a tool that
drives a real browser at a landing page, watches every analytics and ad-tech request it makes,
checks that telemetry against fixed rules, and then has an LLM translate the findings into
business risk for whoever controls the ad budget.

The question it answers is **"is this page technically safe to put ad spend behind?"** — a
go/no-go decision, not a metrics dashboard.

## Stack

- **Backend:** Node.js + Express (CommonJS)
- **Browser automation:** Playwright (Chromium) — mandatory, the whole point is observing real
  network behaviour rather than parsing HTML
- **Frontend:** React 18 + Vite + Tailwind CSS v3
- **Database:** Supabase (`@supabase/supabase-js`) for logging audit runs
- **LLM:** Google Gemini via `@google/generative-ai`

Default test target: a product page on `neemans.com`. **Verify the URL resolves before hard-coding
it** — fetch `https://neemans.com/products.json?limit=5` and use a real handle. Product URLs go
stale.

## The architectural rule that matters most

```
Playwright session  →  deterministic checks  →  LLM interpretation  →  report
   (observation)          (fact)                 (judgement)          (decision)
```

Each stage consumes only the stage before it. **The model never decides what fired.** It receives
facts already established by code and only interprets what they mean commercially. Build the
deterministic layer first and completely; wire the LLM in last.

This split is the single most important thing about the project. Enforce it in code, surface it
in the UI, and be able to defend it.

## Files to produce

| File | Responsibility |
| --- | --- |
| `server.js` | Express API, Playwright session, network interception, deterministic checks, scoring |
| `trackingTaxonomy.js` | Vendor URL patterns, standard event vocabularies, volatile-param list |
| `geminiService.js` | Prompt construction, schema-constrained Gemini call, retry, fallback |
| `supabaseClient.js` | Logs every run; degrades to in-memory when unconfigured |
| `schema.sql` | Supabase table + indexes + RLS policies |
| `scripts/export-report.js` | Runs an audit and writes Markdown + JSON to `sample-report/` |
| `client/src/App.jsx` | URL input, progress, run history |
| `client/src/Dashboard.jsx` | The report itself |
| `.env.example`, `.gitignore`, `README.md`, `NOTE.md` | |

---

## 1. `trackingTaxonomy.js`

A table of ~15 ad-tech vendors, each `{ id, label, family, match: (url) => boolean }`:

`ga4` (`google-analytics.com|analytics.google.com` + `/g/collect` or `/mp/collect`), `ua`
(legacy `/collect`, excluding `/g/collect`), `gtm`, `google_ads` (googleadservices /
doubleclick), `meta_pixel` (`facebook.com/tr` or `fbevents.js`), `tiktok`, `pinterest`, `snap`,
`bing`, `criteo`, `klaviyo`, `clarity`, `hotjar`, `shopify` (monorail-edge), `segment`.

Also export:
- `REQUIRED_VENDOR_IDS = ['ga4', 'meta_pixel']` — the baseline for a pass
- `META_STANDARD_EVENTS` — Meta's standard event vocabulary as a Set (~18 entries)
- `GA4_STANDARD_EVENTS` — GA4's recommended events as a Set (~23 entries)
- `CONVERSION_EVENT_PATTERNS` — regexes for commercial intent (add to cart, checkout, purchase,
  lead, subscribe)
- `VOLATILE_PARAMS` — params that change on every hit and must be ignored when de-duplicating:
  `_p _s seq sid sct _et ts z rnd random cache cb eid event_id eventID rl if ler tfd dl dr _z v
  jsonp callback _fbp_ts`
- helpers `classifyVendor`, `isConversionEvent`, `isStandardEvent`

**Hardcode this deliberately and be ready to justify it.** `facebook.com/tr?ev=Purchase` *is* a
Meta Pixel purchase event — a documented fact about a published API, not a judgement call. Asking
a model would make a settled fact probabilistic, and an auditor whose vendor list wobbles between
runs can't authorise spend. It's also ~400 requests per audit: regex is free, API calls aren't.

## 2. `server.js` — the Playwright session

Launch Chromium (`--no-sandbox`, `--disable-dev-shm-usage`), fresh context per audit, viewport
`1366×900`, desktop Chrome UA, `locale: 'en-IN'` so an India-local session sees the same currency
and regional scripts a real shopper triggers.

**Three listeners do the real work:**

- `page.on('request')` — call `classifyVendor(url)`, return immediately if it isn't ad-tech. For
  matches: parse query params **and** POST bodies (GA4 sends newline-delimited urlencoded
  batches; Segment/Shopify/TikTok send JSON — flatten it). Cap rows per request at 20, some
  beacons carry hundreds. Extract a vendor-specific event name (`en` for GA4, `ev` for Meta,
  `event` for TikTok, `label` for Google Ads…), the account id (`tid`/`id`/`sid`), and a dedup
  fingerprint.
- `page.on('response')` — write HTTP status back onto the matching request via a `byUrl` Map.
- `page.on('requestfailed')` — catch requests that never got a response at all.

**That third listener is not optional.** Transport failures (`ERR_CONNECTION_TIMED_OUT`,
`ERR_ABORTED`) produce no response event, and on a real Neeman's page these are consistently the
highest-severity findings. A response listener alone misses them entirely.

Also capture `console` errors and `pageerror`.

**Interaction phases.** Keep a mutable `currentPhase` string (`load → consent → scroll →
add_to_cart → settle`) and stamp it onto every intercepted request along with a ms offset. This is
what lets the report say *"the add-to-cart click produced no conversion event"* instead of the much
weaker *"AddToCart is missing"* — you can prove **when** a beacon fired relative to the interaction
that should have caused it.

**Sequence:**
1. `page.goto(url, { waitUntil: 'domcontentloaded' })` — not `load`, ad-tech routinely hangs it
2. `waitForLoadState('networkidle')` capped at 20s, then settle ~2.5s
3. Dismiss consent — walk ~6 selectors (`#onetrust-accept-btn-handler`, text matches for
   "Accept all" / "I Agree" / "Got it"). **Most tags fire nothing until consent is granted**, so
   skipping this falsely reports missing pixels
4. Scroll in viewport-sized steps (~80% height) with ~350ms pauses, then back to top — real
   stepping, not a jump, so lazy-loaded and scroll-depth tags actually trigger
5. Select a variant/size (many PDPs disable the CTA otherwise), then walk ~9 add-to-cart selectors
   from specific (`button[name="add"]`, `form[action*="/cart/add"] button[type="submit"]`) to
   text-based. **Per selector try a normal click, then a forced click** — a sticky header
   intercepts the pointer on Neeman's and the forced fallback is what makes it work
6. Wait ~4s — conversion beacons fire *after* the click

Close context and browser in a `finally` with `.catch(() => {})` so a crashed page doesn't leak
Chromium processes.

## 3. `server.js` — the eight deterministic checks

Define them in a `CHECK_DEFINITIONS` array where each carries `{ id, label, question, method }` —
`question` is what a marketer is really asking, `method` is the exact rule in plain words. **Ship
`method` in the API payload and show it in the UI**, so a reader can audit the auditor.

| Check | Rule |
| --- | --- |
| The page actually loads | Navigation is HTTP 2xx **and** final URL is the same host as requested (strip `www.`) |
| Your tags are installed and firing | Assert GA4 and Meta Pixel each produced ≥1 request |
| Nothing fires twice | SHA-1 over vendor + event name + payload with `VOLATILE_PARAMS` stripped; a shared fingerprint is a genuine double-fire, not two legitimate events |
| The data actually arrives | Flag any 4xx/5xx or transport-level failure, grouped by vendor + status |
| One account per platform | Assert each vendor resolves to exactly one distinct account id |
| Add to cart gets tracked | Assert a conversion-intent event reached each installed ad platform **during the `add_to_cart` phase** |
| Event names make sense to the platforms | Set membership against the Meta and GA4 vocabularies |
| Nothing dead is still running | Flag Universal Analytics hits |

Each check records `status: 'pass' | 'fail' | 'not_applicable'` plus a human `detail`, and links
the issue ids it produced.

**Report passing checks, not only failures.** A checklist that shows only problems can't
distinguish "checked and fine" from "never checked" — a meaningful difference when the output
authorises spend. When the add-to-cart CTA can't be found, mark the check `not_applicable`, never
pass or fail: an honest third state beats a misleading binary.

**Scoring:** start at 100, subtract 25/10/3 per High/Medium/Low. Any High → `NOT_READY`; score
<80 → `READY_WITH_FIXES`; else `READY`.

## 4. `geminiService.js`

Default model `gemini-3.6-flash`. **Don't trust a hardcoded model name** — if you get a 404,
list `https://generativelanguage.googleapis.com/v1beta/models?key=…` and pick a current one.

System instruction: *act as a Senior Business Analyst on a performance-marketing team, writing for
a non-technical stakeholder who controls the ad budget and does not know what an XHR is.* Rules:
work only from the supplied telemetry, never invent events or statuses; every issue must translate
a technical fact into a money consequence; prefer adding findings the deterministic layer couldn't
reason about over restating ones it already made.

**Send exactly this and nothing more:**
- page load result, the summary counters, the vendor inventory
- a chronological event log capped at 120 entries, **projected to 8 fields**: `tMs, phase, vendor,
  event, status, accountId, isConversion, isStandardEvent`
- duplicate fingerprint groups
- failed requests capped at 20
- non-standard event names
- the deterministic issues **title-only** — enough to avoid restating them, not enough for your
  phrasing to anchor its analysis

Note `isConversion` and `isStandardEvent` arrive **pre-computed as booleans**. The model gets the
*answer* to classification, never the question. Never send raw params, fingerprints, or full
`networkLog` objects.

Constrain output with a `responseSchema` so malformed replies are impossible rather than merely
unlikely. Ask for: `headline`, `executive_summary`, `event_taxonomy` (per event: category as
standard/custom_clear/custom_ambiguous/malformed/internal_debug, plain-English meaning, the name
it *should* have), `issues` (title, severity, category, business_risk, technical_evidence,
recommended_fix, affected_metric), `recommended_next_steps`.

**Retry with exponential backoff + jitter on 429/500/502/503/504, ~4 attempts** — transient 503s
are common and cost you the whole analysis otherwise. If it still fails, fall back to a
deterministic-only report with `aiAvailable: false` and say so visibly in the UI. A tracking
auditor must not become unusable because a third-party API had a bad minute.

## 5. `supabaseClient.js` + `schema.sql`

Table `audit_runs`: id, created_at, user_id, target_url, started_at, finished_at, duration_ms,
verdict, readiness_score, high/medium/low counts, total_tracking_requests, vendors_detected
(`text[]`), ai_available, headline, and `report jsonb` holding the whole thing. Index on
`started_at desc`. Enable RLS with policies for authenticated users reading their own rows; the
server writes with the service-role key and bypasses RLS.

**Postgres `jsonb` rejects ` `**, and raw tracking payloads contain null bytes and occasional
lone UTF-16 surrogates. Recursively scrub every string before insert or your writes fail with
`unsupported Unicode escape sequence`. This will bite you — handle it up front.

When Supabase env vars are absent, degrade to an in-memory Map rather than crashing.

## 6. API

- `POST /api/audit` `{ url, interactions }` → full report
- `GET /api/audits?limit=` → recent runs
- `GET /api/audits/:id` → one run
- `GET /api/health` → which integrations are configured

## 7. The dashboard

Present it as a **printed engineering inspection report**, not a card dashboard. Avoid the
generated-UI tells: uniform rounded white cards on grey, chips on everything, a score ring,
evenly-spaced boxes.

**Type:** the IBM Plex superfamily — Plex Serif for headlines and prose, Plex Sans for interface,
Plex Mono for anything a machine produced (URLs, IDs, timings, statuses). **Do not use Inter** —
it's the signature "AI-generated startup site" typeface.

**Palette:** warm paper `#FBFAF7`, ink `#1B1A16` with muted `#65614F` and faint `#96917E`, hairline
rule `#E7E2D6`. Colour is signal only, never decoration: red `#A32B1F`, amber `#946200`, green
`#2D6A45`, violet `#574A8C` for AI.

**Structure:** numbered sections (01, 02, 03…) separated by hairline rules, **numbered at render
time** since sections are conditional — hard-coded numbers leave gaps when a section is hidden.
Masthead carries a verdict stamp (`HOLD` / `CONDITIONAL` / `CLEARED`), a large serif score with
`/100`, and one stacked severity bar with the definitions beneath it.

**The provenance split must be loud.** Every finding is stamped `MEASURED` or `AI`, differentiated
four ways simultaneously:
1. Solid black badge vs solid violet badge — filled, not outlined
2. Solid severity rail vs **dashed** rail
3. Upright semibold serif title vs **italic** serif title
4. Plain background vs faint violet tint

Add a "Two kinds of finding" section putting both treatments side by side, a `both / measured / ai`
filter, and a "how this was determined" block inside each expanded finding showing either the
exact deterministic rule or an explicit note that the model judged severity and impact but never
decided what fired.

**Copy must sound like a person.** "Don't spend yet." not "Not ready — hold spend". "Wastes money
or hides sales. Deal with this before launch." not "Budget actively misallocated". Severity reads
*serious / middling / minor*. Loading states name the real steps ("scrolling, then clicking add to
cart"), not "Processing…".

Sections: executive summary, provenance key, checklist, next steps, findings, tags detected, event
naming table, duplicates, raw evidence (timeline + full event table), footer.

## 8. `scripts/export-report.js`

Runs an audit and writes `sample-report/audit-report.md` (human-readable, mirrors the dashboard)
and `audit-raw.json` (everything). Abridge evidence URLs to origin + path + diagnostic params
(`tid`, `en`, `ev`, `id`) with a `(+N params)` suffix — raw tracking URLs run ~1000 chars and
wreck a document a person reads. Write it as a script, not a copy-paste, so the sample regenerates
on demand.

## 9. `NOTE.md`

A design note covering: approach and architecture, assumptions, trade-offs, what's deterministic,
and where the LLM adds meaningful value. **State the limitations plainly rather than burying
them** — it's the most valuable part of the document:

- **Single-run sampling is the weakest point.** Across repeated runs of the same URL, add-to-cart
  tracking both passed and failed, and Meta Pixel showed 1 then 2 account IDs. Real variance in the
  site under different timing and consent conditions, not auditor flakiness. A single audit is
  evidence, not proof. Three runs marking findings "consistent" vs "intermittent" would be
  materially more trustworthy — and intermittent conversion tracking is arguably *worse* than a
  consistent failure, because it's invisible in aggregate reporting.
- **A vendor not in the table is invisible.** Mitigation worth naming: pass *unrecognised*
  third-party beacon hosts to the LLM and ask it to identify likely ad-tech. Deterministic where
  the answer is known, model-based where it genuinely isn't.
- **Selector heuristics** are the least portable part and the only place heuristics are used
  instead of fixed rules.
- **Full failed-request URLs reach the prompt** (~48% of a ~37KB payload) carrying `cid` and
  `first_party_id` pseudonymous identifiers. Harmless for a synthetic session; would need stripping
  against real user sessions, and truncating would roughly halve prompt cost with no analytical
  loss since the failure code carries the signal, not the query string.

## Working method

Verify rather than assume, at every step:

- Run a **real audit against the live Neeman's page** and show actual output — vendors detected,
  events captured, issues found. Don't claim it works from reading the code.
- Build the client and load it in a browser; look at the rendered page.
- If something takes longer than expected or a check behaves oddly, investigate before reporting.
- Report honestly: if the LLM call failed, say so and show the error. If a URL 404s, fix it and say
  you did.

Expect a good run against Neeman's to find roughly: 8 vendors (GTM, GA4, Meta Pixel, Google Ads,
Snap, Criteo, Clarity, Hotjar), ~300–400 tracking requests, ~60 parsed events, custom event names
like `checkout_gokwik` / `kp_atc` / `loyalty_touchpoint_view` / `scroll_depth`, GA4 fragmented
across multiple measurement IDs, and transport failures on GA4 and Criteo. Verdict `NOT_READY`.
