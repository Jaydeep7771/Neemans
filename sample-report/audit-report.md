# Landing Page Pre-Flight Report

**HOLD — not ready for paid traffic** · Readiness **0/100**

> Ad Spend at Risk: Fragmented GA4 Tracking, Criteo Retargeting Failure, and Non-Standard Event Taxonomy Undermine ROAS

| Field | Value |
| --- | --- |
| Target | https://neemans.com/products/the-luxe-loafers-tan |
| Audited | Tue, 15 Sep 2026 19:15:32 GMT |
| Session length | 41.6s (real headless Chromium) |
| Page response | HTTP 200 — "Buy The Luxe Loafers in Tan for PU Faux Leather Fit Comfort" |
| Add-to-cart simulated | yes |
| Tracking requests intercepted | 313 |
| Tracking events parsed | 62 |
| Vendors detected | 8 |
| Findings | 4 high · 6 medium · 0 low |
| Analysis model | gemini-3.6-flash |
| Run ID | d4afeef1-4191-4d0c-bc84-98360764ac5e |

## How to read this report

Every finding is attributed. **MEASURED** (6) comes from a fixed rule applied to the
network traffic captured in the browser session — identical on every run of unchanged code.
**READ** (4) is Gemini interpreting those measurements commercially. It assigns severity
and business impact; it never decides what fired.

## Executive summary

_READ — Gemini_

During the audited session, critical marketing tracking failed across multiple vendors. Retargeting provider Criteo completely timed out (100% loss of retargeting signal for this session), while Google Analytics 4 (GA4) traffic was fragmented across 3 separate property IDs with 28 network request aborts affecting essential product view and cart signals. Additionally, non-standard event naming (such as 'checkout_gokwik' instead of standard 'begin_checkout' and duplicate 'kp_atc' events on Meta) prevents ad platforms from accurately optimizing campaign bidding towards real bottom-of-funnel buyers.

## Pre-flight checklist — 5/8 pass

_MEASURED. Each check states the exact deterministic rule it applies._

### [PASS] The page actually loads

- **Asks:** Does the ad click land somewhere that works?
- **Rule:** Asserts the navigation response is HTTP 2xx and that the final URL is on the same host as the requested URL (after stripping "www.").
- **Result:** HTTP 200 on the requested origin -- "Buy The Luxe Loafers in Tan for PU Faux Leather Fit Comfort".

### [PASS] Your tags are installed and firing

- **Asks:** Are the pixels really there, and are they running?
- **Rule:** Matches every request URL against a table of known vendor endpoints, then asserts GA4 and Meta Pixel each produced at least one request.
- **Result:** All required tags fired: Google Analytics 4, Meta (Facebook) Pixel. 8 vendor(s) detected in total.

### [PASS] Nothing fires twice

- **Asks:** Is anything getting counted more than once?
- **Rule:** SHA-1 fingerprint over vendor + event name + payload, with volatile params (_p, seq, sid, cache-busters, timestamps) removed. Two hits sharing a fingerprint are a genuine double-fire, not two legitimate events.
- **Result:** 62 event(s) fingerprinted; every payload was unique.

### [FAIL] The data actually arrives

- **Asks:** Did the tracking reach Google and Meta, or die on the way?
- **Rule:** Records the HTTP status of each tracking request and flags any 4xx/5xx or transport-level failure (timeout, aborted, DNS).
- **Result:** High: Criteo request failed · High: Google Analytics 4 request failed

### [FAIL] One account per platform

- **Asks:** Is your data being split across duplicate accounts?
- **Rule:** Extracts the account identifier (tid / id / sid) from every hit and asserts each vendor resolves to exactly one distinct ID.
- **Result:** Medium: Google Tag Manager is reporting to 5 different IDs · Medium: Criteo is reporting to 2 different IDs · Medium: Google Analytics 4 is reporting to 3 different IDs

### [PASS] Add to cart gets tracked

- **Asks:** When someone shows they want to buy, do the ad platforms hear about it?
- **Rule:** Tags every request with the interaction phase it fired in, then asserts that a conversion-intent event reached each installed ad platform during the add_to_cart phase.
- **Result:** Add-to-cart click produced 2 conversion event(s): Google Analytics 4/add_to_cart, Meta (Facebook) Pixel/AddToCart.

### [FAIL] Event names make sense to the platforms

- **Asks:** Can Google and Meta understand what you're sending them?
- **Rule:** Set membership against the 18 Meta standard events and the 23 GA4 recommended events held in trackingTaxonomy.js. Anything outside them is a custom name.
- **Result:** Medium: 9 non-standard event name(s) in use

### [PASS] Nothing dead is still running

- **Asks:** Are you still sending data to something that shut down?
- **Rule:** Flags hits to the Universal Analytics collect endpoint, which no longer processes data.
- **Result:** No Universal Analytics traffic observed.

## Recommended actions, most urgent first

_READ — Gemini_

1. Audit and consolidate Google Tag Manager setup to stream all web analytics into one single GA4 Measurement ID, removing secondary IDs (G-VDE0ZFZ4LP, G-5RYZDGXEFH).
2. Fix Criteo script integration error (net::ERR_CONNECTION_TIMED_OUT) to restore retargeting pixel functionality.
3. Update GoKwik payment integration tags in GTM to fire standard 'begin_checkout' instead of custom 'checkout_gokwik'.
4. Disable duplicate Meta Pixel app events ('kp_atc', 'kp_visitors') to ensure single-source-of-truth conversion reporting in Meta Ads Manager.

## Findings — 10

### High · MEASURED — Criteo request failed

1 Criteo request(s) failed at the transport layer (net::ERR_CONNECTION_TIMED_OUT). Affected event(s): n/a.

Requests captured (abridged to diagnostic params — full URLs in `audit-raw.json`):

- `https://gum.criteo.com/fpm/init?first_party_domain=neemans.com (+4 params)`

### High · MEASURED — Google Analytics 4 request failed

28 Google Analytics 4 request(s) failed at the transport layer (net::ERR_ABORTED). Affected event(s): page_view, view_item, checkout_gokwik, loyalty_touchpoint_view, scroll, scroll_depth, Neemans_Opti_Tracking, inp_slow_interaction, form_start, add_to_cart.

Requests captured (abridged to diagnostic params — full URLs in `audit-raw.json`):

- `https://analytics.google.com/g/collect?tid=G-3042L5GP9T&en=page_view (+44 params)`
- `https://analytics.google.com/g/collect?tid=G-3042L5GP9T&en=view_item (+38 params)`
- `https://www.google-analytics.com/g/collect?tid=G-VDE0ZFZ4LP&en=page_view (+32 params)`

### High · READ — Criteo Retargeting Pixel Timed Out Completely

**Business risk.** High-intent users viewing this product are not being captured into Criteo retargeting pools. Paid traffic driven to this page cannot be re-engaged via display retargeting, leading directly to wasted ad spend and lost recovery sales.
**Observed.** Criteo initialization request (https://gum.criteo.com/fpm/init) failed with net::ERR_CONNECTION_TIMED_OUT.
**Metric at risk.** Retargeting Audience Size / Criteo ROAS
**Fix.** Audit Criteo script injection in GTM/Shopify app settings to ensure script host is accessible and not blocked by synchronous script dependencies.

### High · READ — GA4 Data Fragmentation Across 3 Property IDs with 28 Failed Beacons

**Business risk.** Session data, conversion credit, and behavioral signals are being split across 3 distinct GA4 properties (G-3042L5GP9T, G-VDE0ZFZ4LP, G-5RYZDGXEFH). Critical events like view_item and page_view failed with net::ERR_ABORTED, causing incomplete funnel attribution and under-reporting conversion rates in main reporting dashboards.
**Observed.** GA4 requests fired to 3 separate IDs; 28 network tracking requests failed with net::ERR_ABORTED including view_item for G-3042L5GP9T at 2954ms.
**Metric at risk.** GA4 Conversion Rate, Purchase Funnel Drop-off
**Fix.** Consolidate GA4 configuration into a single master Measurement ID in GTM. Remove legacy or duplicate GA4 tags to prevent browser network congestion and request cancellations.

### Medium · MEASURED — Google Tag Manager is reporting to 5 different IDs

IDs observed: G-3042L5GP9T, AW-766814719, GT-5D9RG3BJ, G-5RYZDGXEFH, G-VDE0ZFZ4LP.

### Medium · MEASURED — Criteo is reporting to 2 different IDs

IDs observed: b263b773-70d7-4ac1-a64d-31d499747cb8, e052b0b0-6241-479b-a862-17bca461f36d.

### Medium · MEASURED — Google Analytics 4 is reporting to 3 different IDs

IDs observed: G-3042L5GP9T, G-VDE0ZFZ4LP, G-5RYZDGXEFH.

### Medium · MEASURED — 9 non-standard event name(s) in use

Events outside the platform's standard vocabulary: Meta (Facebook) Pixel:kp_visitors, Google Analytics 4:checkout_gokwik, Google Analytics 4:loyalty_touchpoint_view, Meta (Facebook) Pixel:kp_engaged_visitors, Google Analytics 4:scroll_depth, Google Analytics 4:Neemans_Opti_Tracking, Google Analytics 4:inp_slow_interaction, Google Analytics 4:form_start, Meta (Facebook) Pixel:kp_atc.

### Medium · READ — Non-Standard Checkout Event ('checkout_gokwik') Breaks Standard Funnel Attribution

**Business risk.** Using custom event names like 'checkout_gokwik' instead of standard GA4 schema prevents Google Analytics from recognizing when users begin the checkout process. Automated smart bidding tools will fail to optimize for checkout initiation steps.
**Observed.** GA4 event 'checkout_gokwik' observed at t=10421ms instead of standard 'begin_checkout'.
**Metric at risk.** Begin Checkout Conversions / Google Smart Bidding Optimization
**Fix.** Map the GoKwik checkout trigger to fire the standard GA4 'begin_checkout' event with appropriate e-commerce items payload.

### Medium · READ — Duplicate Meta Pixel Signals ('kp_atc' alongside 'AddToCart')

**Business risk.** Firing both standard 'AddToCart' and custom 'kp_atc' on the same user action risks double-counting cart additions in Meta Ads Manager if custom conversions are configured improperly, leading to inflated ROAS reporting and distorted ad set optimization.
**Observed.** Meta Pixel received 'AddToCart' at t=36862ms and 'kp_atc' at t=38578ms for a single user click.
**Metric at risk.** Meta Cost Per Add To Cart / ROAS Accuracy
**Fix.** Disable redundant third-party Shopify app pixel events in Meta or standardize event parameters while maintaining a single AddToCart signal.

## Tags detected on the page

_MEASURED — observed transmitting in a real browser session._

| Vendor | Hits | Account IDs | Events observed |
| --- | --- | --- | --- |
| Google Tag Manager | 7 | G-3042L5GP9T, AW-766814719, GT-5D9RG3BJ, G-5RYZDGXEFH, G-VDE0ZFZ4LP | — |
| Meta (Facebook) Pixel | 167 | 223335195137418 | PageView, kp_visitors, kp_engaged_visitors, AddToCart, kp_atc |
| Criteo | 3 | b263b773-70d7-4ac1-a64d-31d499747cb8, e052b0b0-6241-479b-a862-17bca461f36d | — |
| Google Analytics 4 | 28 | G-3042L5GP9T, G-VDE0ZFZ4LP, G-5RYZDGXEFH | page_view, view_item, checkout_gokwik, loyalty_touchpoint_view, scroll, scroll_depth, Neemans_Opti_Tracking, inp_slow_interaction, form_start, add_to_cart |
| Snap Pixel | 21 | — | — |
| Google Ads Conversion | 28 | — | conversion:TDqLCKGF3_YbEP_T0u0C, conversion:u-vGCKSF3_YbEP_T0u0C, conversion, conversion:CXh7CI2gxvoaEP_T0u0C, conversion:Lej_CISgxvoaEP_T0u0C, conversion:lwnICJ6F3_YbEP_T0u0C, conversion:q-ZgCJzr64UYEP_T0u0C, conversion:zbObCJD0uPoaEP_T0u0C |
| Hotjar | 4 | — | — |
| Microsoft Clarity | 55 | — | — |

## Event naming review

_Whether a name is standard is MEASURED; what it means and what it should be is READ._

| Event sent | Platform | Category | What it means | Should be called |
| --- | --- | --- | --- | --- |
| `page_view` | Google Analytics 4 | standard | User loaded a page on the website. | — no change — |
| `view_item` | Google Analytics 4 | standard | User viewed a specific product detail page (The Luxe Loafers in Tan). | — no change — |
| `conversion:TDqLCKGF3_YbEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on page load. | `conversion` |
| `conversion:u-vGCKSF3_YbEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on page load. | `conversion` |
| `conversion` | Google Ads Conversion | standard | Generic Google Ads remarketing or conversion hit. | — no change — |
| `conversion:CXh7CI2gxvoaEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on page load. | `conversion` |
| `PageView` | Meta (Facebook) Pixel | standard | User loaded a page for Meta audience building. | — no change — |
| `kp_visitors` | Meta (Facebook) Pixel | custom_ambiguous | Custom app tracking visitor landing on the page. | — no change — |
| `checkout_gokwik` | Google Analytics 4 | custom_clear | User initiated checkout via GoKwik payment gateway. | `begin_checkout` |
| `loyalty_touchpoint_view` | Google Analytics 4 | custom_clear | User viewed a loyalty program widget/touchpoint. | — no change — |
| `conversion:Lej_CISgxvoaEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered. | `conversion` |
| `kp_engaged_visitors` | Meta (Facebook) Pixel | custom_ambiguous | User scrolled or spent time on site according to third-party app. | — no change — |
| `scroll` | Google Analytics 4 | standard | User scrolled past 90% of the page. | — no change — |
| `scroll_depth` | Google Analytics 4 | custom_clear | User reached a specific scroll milestone. | `scroll` |
| `Neemans_Opti_Tracking` | Google Analytics 4 | internal_debug | Internal optimization or A/B testing framework metric. | — no change — |
| `inp_slow_interaction` | Google Analytics 4 | internal_debug | Technical performance metric monitoring slow page interaction times. | — no change — |
| `form_start` | Google Analytics 4 | custom_clear | User interacted with a form element. | — no change — |
| `add_to_cart` | Google Analytics 4 | standard | User clicked the Add To Cart button. | — no change — |
| `conversion:lwnICJ6F3_YbEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on Add to Cart. | `conversion` |
| `conversion:q-ZgCJzr64UYEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on Add to Cart. | `conversion` |
| `conversion:zbObCJD0uPoaEP_T0u0C` | Google Ads Conversion | standard | Google Ads conversion action triggered on Add to Cart. | `conversion` |
| `AddToCart` | Meta (Facebook) Pixel | standard | User added item to cart for Meta retargeting and optimization. | — no change — |
| `kp_atc` | Meta (Facebook) Pixel | custom_clear | Duplicate Add To Cart event triggered by third-party app. | `AddToCart` |

## Duplicate events

_MEASURED — identical payload fingerprint seen more than once._

_None._

## What the browser did

| At | Step | Detail |
| --- | --- | --- |
| +2553ms | navigation | HTTP 200 -> https://neemans.com/products/the-luxe-loafers-tan |
| +31673ms | scroll | Scrolled through the full page and back to top |
| +35928ms | add_to_cart | Clicked add-to-cart CTA (form[action*="/cart/add"] button[type="submit"]) |

## Full event log — 62 events

| At | Phase | Vendor | Event | HTTP | Account |
| --- | --- | --- | --- | --- | --- |
| +2951ms | load | Google Analytics 4 | `page_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +2954ms | load | Google Analytics 4 | `view_item` | net::ERR_ABORTED | G-3042L5GP9T |
| +3439ms | load | Google Ads Conversion | `conversion:TDqLCKGF3_YbEP_T0u0C` | 200 | — |
| +3442ms | load | Google Ads Conversion | `conversion:u-vGCKSF3_YbEP_T0u0C` | 200 | — |
| +3576ms | load | Google Ads Conversion | `conversion:TDqLCKGF3_YbEP_T0u0C` | 302 | — |
| +3578ms | load | Google Ads Conversion | `conversion:u-vGCKSF3_YbEP_T0u0C` | 302 | — |
| +5468ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +5468ms | load | Google Ads Conversion | `conversion:CXh7CI2gxvoaEP_T0u0C` | 200 | — |
| +5471ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +6279ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +6282ms | load | Google Ads Conversion | `conversion:CXh7CI2gxvoaEP_T0u0C` | 302 | — |
| +6284ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +6447ms | load | Google Analytics 4 | `page_view` | net::ERR_ABORTED | G-VDE0ZFZ4LP |
| +7080ms | load | Meta (Facebook) Pixel | `PageView` | 200 | 223335195137418 |
| +7472ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +7794ms | load | Meta (Facebook) Pixel | `kp_visitors` | 200 | 223335195137418 |
| +7813ms | load | Google Ads Conversion | `conversion` | 200 | — |
| +10421ms | load | Google Analytics 4 | `checkout_gokwik` | net::ERR_ABORTED | G-3042L5GP9T |
| +10421ms | load | Google Analytics 4 | `loyalty_touchpoint_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +10421ms | load | Google Analytics 4 | `loyalty_touchpoint_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +10421ms | load | Google Analytics 4 | `loyalty_touchpoint_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +23777ms | load | Google Ads Conversion | `conversion:Lej_CISgxvoaEP_T0u0C` | 200 | — |
| +23883ms | load | Google Ads Conversion | `conversion:Lej_CISgxvoaEP_T0u0C` | 302 | — |
| +28714ms | scroll | Meta (Facebook) Pixel | `kp_engaged_visitors` | 200 | 223335195137418 |
| +30709ms | scroll | Google Analytics 4 | `scroll` | net::ERR_ABORTED | G-5RYZDGXEFH |
| +31006ms | scroll | Google Analytics 4 | `scroll_depth` | net::ERR_ABORTED | G-3042L5GP9T |
| +31006ms | scroll | Google Analytics 4 | `scroll_depth` | net::ERR_ABORTED | G-3042L5GP9T |
| +31006ms | scroll | Google Analytics 4 | `scroll_depth` | net::ERR_ABORTED | G-3042L5GP9T |
| +31006ms | scroll | Google Analytics 4 | `scroll_depth` | net::ERR_ABORTED | G-3042L5GP9T |
| +34552ms | add_to_cart | Google Analytics 4 | `scroll` | net::ERR_ABORTED | G-VDE0ZFZ4LP |
| +34554ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +34848ms | add_to_cart | Meta (Facebook) Pixel | `PageView` | 200 | 223335195137418 |
| +35050ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +35692ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +35912ms | add_to_cart | Google Analytics 4 | `scroll_depth` | net::ERR_ABORTED | G-3042L5GP9T |
| +35912ms | add_to_cart | Google Analytics 4 | `Neemans_Opti_Tracking` | net::ERR_ABORTED | G-3042L5GP9T |
| +35912ms | add_to_cart | Google Analytics 4 | `inp_slow_interaction` | net::ERR_ABORTED | G-3042L5GP9T |
| +35913ms | add_to_cart | Google Analytics 4 | `inp_slow_interaction` | net::ERR_ABORTED | G-3042L5GP9T |
| +35913ms | add_to_cart | Google Analytics 4 | `inp_slow_interaction` | net::ERR_ABORTED | G-3042L5GP9T |
| +35913ms | add_to_cart | Google Analytics 4 | `Neemans_Opti_Tracking` | net::ERR_ABORTED | G-3042L5GP9T |
| +35913ms | add_to_cart | Google Analytics 4 | `loyalty_touchpoint_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +35915ms | add_to_cart | Google Analytics 4 | `page_view` | net::ERR_ABORTED | G-3042L5GP9T |
| +35922ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +35923ms | add_to_cart | Google Analytics 4 | `form_start` | net::ERR_ABORTED | G-5RYZDGXEFH |
| +35923ms | add_to_cart | Google Analytics 4 | `form_start` | net::ERR_ABORTED | G-VDE0ZFZ4LP |
| +35988ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +35998ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +36809ms | add_to_cart | Google Analytics 4 | `inp_slow_interaction` | net::ERR_ABORTED | G-3042L5GP9T |
| +36809ms | add_to_cart | Google Analytics 4 | `inp_slow_interaction` | net::ERR_ABORTED | G-3042L5GP9T |
| +36810ms | add_to_cart | Google Analytics 4 | `add_to_cart` | net::ERR_ABORTED | G-3042L5GP9T |
| +36811ms | add_to_cart | Google Ads Conversion | `conversion:lwnICJ6F3_YbEP_T0u0C` | 200 | — |
| +36813ms | add_to_cart | Google Ads Conversion | `conversion:q-ZgCJzr64UYEP_T0u0C` | 200 | — |
| +36814ms | add_to_cart | Google Ads Conversion | `conversion:zbObCJD0uPoaEP_T0u0C` | 200 | — |
| +36815ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +36862ms | add_to_cart | Meta (Facebook) Pixel | `AddToCart` | 200 | 223335195137418 |
| +36897ms | add_to_cart | Google Ads Conversion | `conversion:lwnICJ6F3_YbEP_T0u0C` | 302 | — |
| +36909ms | add_to_cart | Google Ads Conversion | `conversion:q-ZgCJzr64UYEP_T0u0C` | 302 | — |
| +37042ms | add_to_cart | Google Ads Conversion | `conversion:zbObCJD0uPoaEP_T0u0C` | 302 | — |
| +37067ms | add_to_cart | Google Ads Conversion | `conversion` | 200 | — |
| +38578ms | add_to_cart | Meta (Facebook) Pixel | `kp_atc` | 200 | 223335195137418 |
| +40866ms | settle | Google Analytics 4 | `page_view` | net::ERR_ABORTED | G-5RYZDGXEFH |
| +40876ms | settle | Google Analytics 4 | `page_view` | net::ERR_ABORTED | G-VDE0ZFZ4LP |

## JavaScript errors on the page

- `TypeError: Failed to fetch`
- `TypeError: Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.`

---

Generated by the Landing Page Pre-Flight Auditor. 8 deterministic checks over 313 intercepted requests, interpreted by Gemini. Captured with a real Chromium session, not static HTML inspection.