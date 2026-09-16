# Landing Page Pre-Flight Auditor — design note

This note covers the approach and architecture, the assumptions I made, the trade-offs I
accepted, which checks are deterministic, and where a model earns its place.

A sample report generated against a live Neeman's product page is in
[`sample-report/audit-report.md`](sample-report/audit-report.md), with the complete raw
capture alongside it in `audit-raw.json`.

---

## 1. Approach

### The question the tool answers

"Is this page technically safe to put ad spend behind?" is a go/no-go decision, so the output
is shaped as a **decision document**, not a metrics dashboard. It opens with a verdict
(`HOLD` / `CONDITIONAL` / `CLEARED`), a readiness score, and a plain-English summary. Detail
sits underneath for whoever has to fix the tags.

### Why a real browser session is the only way to answer it

Modern tracking is almost entirely invisible to static HTML inspection:

- Tags are injected by GTM at runtime; the HTML contains a container snippet, not the tags.
- Most tags fire nothing until a consent banner is dismissed.
- Conversion events only exist as a consequence of interaction.
- A tag can be present and still be **broken** — a pixel returning `400`, or a request that
  times out at the transport layer, looks identical in source to one that works.

That last case is the sharpest argument. In the sample report, Criteo fails with
`net::ERR_CONNECTION_TIMED_OUT` and GA4 aborts 25 requests including `page_view` and
`view_item`. Both tags are perfectly installed. Source inspection would call the page healthy.
Only observing actual network behaviour catches it.

### Pipeline

```
Playwright session  →  deterministic checks  →  Gemini interpretation  →  report
   (observation)          (fact)                  (judgement)            (decision)
```

Each stage only consumes the stage before it. The model sits at the end and never feeds back
into what was observed or measured.

---

## 2. Architecture

| File | Responsibility |
| --- | --- |
| `server.js` | Express API, Playwright session, network interception, deterministic checks, scoring |
| `trackingTaxonomy.js` | Vendor URL patterns, standard event vocabularies, volatile-param list |
| `geminiService.js` | Prompt construction, schema-constrained Gemini call, retry, fallback |
| `supabaseClient.js` | Logs every run; degrades to in-memory when unconfigured |
| `client/src/Dashboard.jsx` | The report, written for a non-technical stakeholder |
| `scripts/export-report.js` | Regenerates the sample artifact on demand |

### The browser session

Chromium via Playwright, `1366×900`, desktop UA, `locale: 'en-IN'` — an India-local session
sees the same currency and regional scripts a real Neeman's shopper triggers. Fresh context
per audit, so consent state and cookies never leak between runs.

Three listeners do the actual work:

- **`page.on('request')`** — classifies every request against the vendor table, discards
  non-tracking traffic immediately, then parses query params and POST bodies (GA4's
  newline-delimited batches, JSON bodies from Segment/Shopify/TikTok), extracts the
  vendor-specific event name and account ID, and computes a dedup fingerprint.
- **`page.on('response')`** — writes HTTP status back onto the matching request.
- **`page.on('requestfailed')`** — catches requests that never got a response at all.

That third listener matters more than it looks. The `ERR_CONNECTION_TIMED_OUT` and
`ERR_ABORTED` failures — the highest-severity findings in the sample report — produce **no
response event**. A response listener alone misses them entirely.

### Interaction phases

A single `currentPhase` variable (`load → consent → scroll → add_to_cart → settle`) is stamped
onto every intercepted request. This is what lets the report assert *"the add-to-cart click
produced no conversion event"* rather than the much weaker *"AddToCart is missing"*. You can
prove **when** a beacon fired relative to the interaction that should have caused it.

The sequence: navigate on `domcontentloaded` (ad-tech routinely hangs `load`), settle to
`networkidle`, dismiss consent, scroll in viewport-sized steps with pauses so lazy-loaded and
scroll-depth tags actually trigger, select a variant, click add-to-cart, then wait 4s because
conversion beacons fire *after* the click.

---

## 3. What is deterministic

Eight checks. Each is a fixed rule over the captured traffic, producing the same answer on
every run of unchanged code. The exact rule is carried in the payload and shown in the UI, so
a reader can audit the auditor.

| Check | Rule |
| --- | --- |
| **The page actually loads** | Navigation response is HTTP 2xx **and** final URL is the same host as requested (after stripping `www.`) |
| **Your tags are installed and firing** | Request URLs matched against a vendor endpoint table; asserts GA4 and Meta Pixel each produced ≥1 request |
| **Nothing fires twice** | SHA-1 over vendor + event name + payload, with volatile params (`_p`, `seq`, `sid`, cache-busters, timestamps) stripped; shared fingerprint = genuine double-fire |
| **The data actually arrives** | Status of every tracking request; flags 4xx/5xx and transport-level failures |
| **One account per platform** | Extracts `tid`/`id`/`sid` per hit; asserts one distinct ID per vendor |
| **Add to cart gets tracked** | Asserts a conversion-intent event reached each installed ad platform during the `add_to_cart` phase |
| **Event names make sense to the platforms** | Set membership against the 18 Meta standard events and 23 GA4 recommended events held in `trackingTaxonomy.js` |
| **Nothing dead is still running** | Flags hits to the Universal Analytics collect endpoint |

Scoring is deterministic too: 100 minus 25/10/3 per High/Medium/Low. Any High → `NOT_READY`.

**Passing checks are reported, not just failures.** A checklist that only shows problems can't
distinguish "this was checked and is fine" from "this was never checked" — a meaningful
difference when the output authorises spend.

### Why the vendor table is hardcoded, deliberately

`facebook.com/tr?ev=Purchase` **is** a Meta Pixel purchase event. That is a documented fact
about a published API, not a judgement call. Asking a model would convert a settled fact into
a probabilistic one, and an auditor whose vendor list wobbles between runs is useless for a
go/no-go decision. Same for the event vocabularies: "is `checkout_gokwik` in GA4's recommended
list?" is set membership.

The vendor table holds 15 platforms; GA4 and Meta Pixel are the two required for a pass.

It is also ~400 requests per audit. Regex is microseconds and free; classification via API is
neither.

---

## 4. Where the LLM adds value

Gemini receives the measurements and does three things that are genuinely judgement, not
lookup:

**1. Categorising messy event names.** Deterministic logic can tell you `checkout_gokwik` is
not in GA4's standard vocabulary. It cannot tell you it *means* `begin_checkout`, that
`kp_atc` is a duplicate of `AddToCart` splitting one conversion signal in two, or that
`inp_slow_interaction` is a developer performance probe that doesn't belong in production
analytics. That requires knowing what these tools are for.

**2. Translating network facts into money.** `ERR_ABORTED` on 25 GA4 requests is a fact. *"Core
traffic and product-view behaviour fails to record, so remarketing feeds are missing and the
web funnel is incomplete"* is what the budget owner needs. That translation is open-ended
language generation over a technical domain — exactly what models are good at, and exactly
what a rules engine cannot produce without me pre-writing every consequence.

**3. Prioritising.** The deterministic layer assigns severity by rule. Gemini weighs findings
against each other in context — that firing 8 Google Ads conversion labels on page load is
worse than fragmented GTM containers, because one corrupts bidding and the other only
complicates reporting.

### The boundary, enforced in code

The model never decides **what fired**. It receives a projected event log of 8 fields per
event, with `isConversion` and `isStandardEvent` already computed as booleans — it gets the
*answer* to the classification question, not the question. The deterministic issue list is
sent title-only, enough to avoid restating findings without letting my phrasing anchor its
analysis.

Output is constrained by a `responseSchema`, so malformed replies are impossible rather than
merely unlikely. If Gemini is unreachable after 4 retries with exponential backoff, the report
still renders with `aiAvailable: false` and a visible "interpretation unavailable" marker.
**A tracking auditor must not become unusable because a third-party API had a bad minute** —
this happened during development on a transient `503` and the fallback behaved correctly.

Every finding in the UI is stamped `MEASURED` or `AI` and the two are styled to be told apart
at a glance -- different badge colour, solid versus dashed severity rail, upright versus italic
title, and a tint behind the AI ones. There is a filter to isolate either. If someone is going
to authorise budget off the back of this, they should never be in doubt about which half of the
report is fact and which is a model's judgement.

---

## 5. Assumptions

1. **GA4 and Meta Pixel are the required baseline.** Hardcoded in `REQUIRED_VENDOR_IDS`. For a
   D2C Shopify brand running paid social and search this holds; a different media mix would
   need a different list.
2. **Add-to-cart is the meaningful conversion proxy on a PDP.** Purchase can't be tested
   without completing a real transaction.
3. **Identical payload minus volatile params = a genuine duplicate.** The volatile-param list
   is the load-bearing assumption here; if a vendor adds a new cache-buster, two legitimate
   events could be misread as one duplicate.
4. **One session represents the page.** See the limitation below — this one is shakier than it
   looks.
5. **A synthetic session carries no real user data.** True as built, and it's what makes
   sending full failed-request URLs to Gemini acceptable.

---

## 6. Trade-offs

**Hardcoded vendor table vs. dynamic discovery.** Chose determinism. The cost: **a vendor not
in the table is invisible** — the auditor would silently ignore an ad platform it doesn't
know. Mitigation worth building: pass *unrecognised* third-party beacon hosts to Gemini and
ask it to identify likely ad-tech. Deterministic where the answer is known, model-based where
it genuinely isn't.

**Selector heuristics for interaction.** `clickAddToCart` walks 9 selectors from specific to
text-based, trying a normal click then a forced click per selector (a sticky header intercepts
the pointer on Neeman's). This is the least portable part of the tool and the only place I use
heuristics rather than fixed rules. When no CTA can be found, the check reports **"not
testable"** rather than passing or failing — an honest third state beats a misleading binary.

**One run vs. repeated sampling.** Single run, for latency. This is the weakest point in the
design and I'd fix it first. Across development runs of the same URL, add-to-cart conversion
tracking both passed and failed, and Meta Pixel showed 1 then 2 account IDs — real variance in
the site under different timing and consent conditions, not auditor flakiness. **A single
audit is evidence, not proof.** Three runs with findings marked "consistent" vs.
"intermittent" would be materially more trustworthy, and intermittent conversion tracking is
arguably a *worse* finding than a consistent failure because it's invisible in aggregate
reporting.

**Full URLs in the prompt.** Failed-request URLs go to Gemini intact — 48% of a ~37KB prompt.
Fine for synthetic sessions, and the query string aids diagnosis. But these carry `cid` and
`first_party_id` pseudonymous identifiers; if this ever ran against real user sessions, that
would need stripping before the prompt is built. Truncating them would also roughly halve
prompt cost with no analytical loss, since the failure code carries the signal, not the query
string.

**Service-role key server-side only.** Supabase writes use the service key, which bypasses
RLS. It never reaches the browser; the client only talks to our own Express API. The table has
RLS policies for authenticated browser reads.

**Caps at 120 events / 20 failed requests** in the prompt. Bounds cost on a page firing 400+
tracking requests, at the risk of truncating a pathological case.

---

## 7. Known limitations

- Single-run sampling, as above. The most important one.
- Unknown vendors are invisible.
- Purchase-side tracking is never exercised.
- Consent handling covers 6 common banner patterns; an unusual CMP would be missed, and the
  audit would under-report tags as a result.
- Checkout, cart, and post-purchase pages are out of scope — this audits the landing page only.
- No cross-run diffing, so regressions in tracking aren't detectable yet. The Supabase schema
  stores the full report as `jsonb` specifically to make that the natural next feature.
