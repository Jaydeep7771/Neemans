import React, { useEffect, useState } from 'react';
import Dashboard from './Dashboard.jsx';
import { apiUrl } from './api.js';

const DEFAULT_URL = 'https://neemans.com/products/the-luxe-loafers-tan';

/* What the browser is actually doing, in order. Shown while the session runs so the
   wait reads as work happening rather than a spinner. */
const STAGES = [
  'Opening a browser',
  'Loading the page, watching what it sends',
  'Scrolling, then clicking add to cart',
  'Working out what all that traffic meant',
  'Asking Gemini what it costs you',
];

const VERDICT_TONE = {
  READY: { color: '#175615', label: 'Good to go' },
  READY_WITH_FIXES: { color: '#8a5607', label: 'Tidy up' },
  NOT_READY: { color: '#a32c2c', label: "Don't spend" },
};

export default function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [interactions, setInteractions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!loading) return undefined;
    setStage(0);
    setElapsed(0);
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    const advance = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 6000);
    return () => {
      clearInterval(tick);
      clearInterval(advance);
    };
  }, [loading]);

  const loadHistory = async () => {
    try {
      const res = await fetch(apiUrl('/api/audits?limit=8'));
      if (res.ok) setHistory(await res.json());
    } catch (_) {
      /* history is optional */
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const runAudit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(apiUrl('/api/audit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, interactions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Audit failed');
      setReport(data);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-40 border-b border-hair bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5 sm:px-6">
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Pre-Flight Auditor
          </span>
          <span className="hidden text-[13px] text-ink-muted sm:block">
            Is this page safe to spend on?
          </span>
        </div>
      </header>

      {/* ---------- Search ---------- */}
      <div className="relative">
        {/* A soft wash of Neeman's leather tone, so the page opens warm rather than clinical. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          style={{ background: 'linear-gradient(180deg, #F6EFE3 0%, rgba(246,239,227,0) 100%)' }}
        />
        <div className="relative mx-auto max-w-5xl px-5 pt-10 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight text-ink sm:text-[44px]">
            Check a landing page
            <br />
            before you spend on it.
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-[16px] leading-relaxed text-ink-muted">
            We open the page in a real browser, act like a shopper, and watch every
            piece of tracking it sends — then tell you what's broken and what it costs.
          </p>
        </div>

        <form onSubmit={runAudit} className="mx-auto mt-8 max-w-2xl">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/product"
              aria-label="Landing page URL"
              className="w-full rounded-full border-0 bg-surface px-5 py-3.5 text-[14px] text-ink shadow-card ring-1 ring-hair transition placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-full bg-brand px-7 py-3.5 text-[14px] font-medium text-white transition hover:bg-brand-light disabled:cursor-not-allowed disabled:bg-ink-faint"
            >
              {loading ? 'Checking…' : 'Check it'}
            </button>
          </div>
          <label className="mt-4 flex cursor-pointer items-center justify-center gap-2.5 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={interactions}
              onChange={(e) => setInteractions(e.target.checked)}
              className="h-4 w-4 rounded accent-brand"
            />
            Act like a real shopper — scroll the page, then click add to cart
            </label>
          </form>
        </div>
      </div>

      <main>
        {loading && (
          <div className="mx-auto max-w-md px-5 py-16">
            <ol className="space-y-1">
              {STAGES.map((s, i) => (
                <li
                  key={s}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 transition ${
                    i === stage ? 'bg-surface shadow-card' : ''
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                      i < stage ? 'bg-brand' : i === stage ? 'bg-brand-light' : 'bg-viz-track'
                    }`}
                    aria-hidden
                  >
                    {i < stage ? '✓' : ''}
                  </span>
                  <span
                    className={`text-[14px] ${
                      i <= stage ? 'text-ink' : 'text-ink-faint'
                    }`}
                  >
                    {s}
                  </span>
                </li>
              ))}
            </ol>
            <p className="tnum mt-6 text-center text-[13px] text-ink-faint">
              {elapsed}s so far · usually takes about a minute
            </p>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-2xl px-5 py-10">
            <div className="rounded-3xl bg-surface p-6 shadow-card ring-1 ring-hair">
              <p className="text-[15px] font-semibold text-[#a32c2c]">That didn't work</p>
              <p className="mt-2 break-words text-[13.5px] leading-relaxed text-ink-muted">
                {error}
              </p>
            </div>
          </div>
        )}

        {report && <Dashboard report={report} />}

        {!report && !loading && history.length > 0 && (
          <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
            <h2 className="mb-4 text-center text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
              Checked recently
            </h2>
            <div className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-hair">
              {history.map((h, i) => {
                const tone = VERDICT_TONE[h.verdict] || {};
                return (
                  <div
                    key={h.id}
                    className={`flex items-center justify-between gap-5 px-5 py-4 ${
                      i ? 'border-t border-hair' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] text-ink">{h.target_url}</p>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        {new Date(h.started_at).toLocaleString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="tnum text-[15px] font-semibold text-ink">
                        {h.readiness_score}
                      </span>
                      <span className="text-[12px] text-ink-faint">/100</span>
                      <p className="text-[11.5px] font-medium" style={{ color: tone.color }}>
                        {tone.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
