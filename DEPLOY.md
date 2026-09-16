# Deploying

The awkward part of this app is that it drives a real Chromium and a full audit
takes **40–100 seconds**. That rules out most default serverless setups, so read
the constraint before picking a host.

## The constraint

| | Requirement | Why |
| --- | --- | --- |
| Runtime | 40–100s per request | Page load, scroll, add-to-cart, settle, then a Gemini call |
| Memory | ~1GB+ | Chromium is not small |
| Bundle | Chromium must be reachable | The full `playwright` package is ~300MB, over Vercel's function limit |

Two deployment shapes work. Both are configured in this repo.

---

## Option A — everything on Vercel (simplest)

One Vercel project serves the React build as static files and runs the API as
serverless functions in `api/`.

`browser.js` detects the serverless environment and swaps the ~300MB `playwright`
package for `playwright-core` (~5MB) driving `@sparticuz/chromium` (~40MB), a
Chromium built for Lambda-style runtimes. Nothing else changes.

```bash
npm i -g vercel
vercel link
vercel --prod
```

Then set the environment variables in **Vercel → Settings → Environment Variables**:

```
GEMINI_API_KEY            your Google AI Studio key
GEMINI_MODEL              gemini-3.6-flash
SUPABASE_URL              https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY your service role key
DEFAULT_TARGET_URL        https://neemans.com/products/the-luxe-loafers-tan
```

**You must enable Fluid Compute** (Settings → Functions). Without it, functions
cap at 60 seconds and every audit times out. With it, the cap is 300s on both
Hobby and Pro, which is what `vercel.json` requests via `maxDuration`.

### Version pinning, which is not optional here

`@sparticuz/chromium`'s major must match the Chromium that `playwright-core`
expects, or the browser starts and dies instantly with the unhelpful message
`Target page, context or browser has been closed`.

| Package | Pinned at | Chromium |
| --- | --- | --- |
| `playwright-core` | 1.63.0 | expects 153 |
| `@sparticuz/chromium` | 153.0.0 | provides 153 |

`browser.js` asserts this at launch and throws a message naming the real problem.
`engines.node` is `>=22.17.0` because `@sparticuz/chromium@153` requires it and
Vercel reads that field to choose the runtime.

Honest expectations on this path:

- **Cold starts hurt.** Unpacking Chromium adds ~5–10s to the first audit after
  an idle period.
- **It runs close to the limit.** A slow target page plus a Gemini retry can
  approach 300s. The audit will fail rather than return a partial report.
- If you hit the 250MB bundle limit, `@sparticuz/chromium-min` fetches the binary
  at runtime instead of bundling it.

## Option B — UI on Vercel, API in a container (more reliable)

Recommended if you want this to be dependable rather than merely deployed. A
container has no execution cap, keeps Chromium warm between requests, and uses
Microsoft's official Playwright image, so there is no serverless Chromium in play
at all.

**1. Deploy the API.** `render.yaml` and `Dockerfile` are ready:

```bash
# Render: New > Blueprint > point at this repo, then fill in the secret env vars
# Or anywhere that runs a container -- Railway, Fly.io, Cloud Run, a VM
docker build -t preflight-auditor .
docker run -p 8787:8787 --env-file .env preflight-auditor
```

Set `CORS_ORIGIN` to your UI's origin rather than leaving it `*`.

**2. Deploy the UI to Vercel** with **Root Directory = `client`**, and set:

```
VITE_API_URL=https://your-api.onrender.com
```

`client/src/api.js` reads that at build time. Leave it unset and the UI calls the
same origin, which is what Option A and local dev both rely on.

Note Render's free tier sleeps after inactivity, so the first audit after a quiet
spell pays a cold start.

---

## Local development

```bash
npm install          # also downloads Chromium
cp .env.example .env # fill in your keys
npm start            # API on :8787
```

```bash
npm --prefix client run dev   # UI on :5173, proxies /api to :8787
```

### If Chromium refuses to launch

On a machine with Windows Application Control, Smart App Control, or strict
endpoint security, you may see:

```
browserType.launch: spawn UNKNOWN
An Application Control policy has blocked this file
```

The policy is blocking Playwright's unsigned `chrome-headless-shell.exe`. Point
the auditor at an installed, signed browser instead:

```
PLAYWRIGHT_CHANNEL=chrome
```

`msedge` works too. This only affects local runs — the Docker image and the
serverless Chromium are both unaffected.

---

## What each file does

| File | Purpose |
| --- | --- |
| `vercel.json` | Builds the client, exposes `api/` as functions, requests `maxDuration: 300`, excludes the heavy `playwright` package from the bundle |
| `api/*.js` | Serverless wrappers over the same audit core used by `server.js` |
| `browser.js` | Chooses bundled Chromium vs serverless Chromium; carries the `PLAYWRIGHT_CHANNEL` escape hatch |
| `scripts/postinstall.js` | Skips the ~300MB Chromium download on serverless builds |
| `Dockerfile` | Playwright base image, pinned to the exact `playwright` version in `package.json` |
| `render.yaml` | One-click Render blueprint for the API |
| `client/src/api.js` | Resolves the API base from `VITE_API_URL`, defaulting to same-origin |

**The Docker tag and the `playwright` version must stay in lockstep** — the image
ships the browser build that version expects, and a mismatch fails at launch.
Both are pinned to `1.63.0`; change them together or not at all.
