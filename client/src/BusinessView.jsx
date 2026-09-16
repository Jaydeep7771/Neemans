import React, { useMemo } from 'react';
import { Panel, Gauge, Donut, BarList, StackedBarList, Funnel, Legend, VIZ } from './charts.jsx';

/**
 * BusinessView.jsx -- the half of the report for whoever signs off the ad budget.
 *
 * No HTTP statuses, no selectors, no event names unless they are the point. Every
 * panel answers a money question: is my spend measured, where is the signal leaking,
 * and what do I fix first.
 */

const VERDICT = {
  READY: {
    stamp: 'Good to go',
    line: 'Tracking looks solid. Turn the spend on.',
    color: '#2D7A2B',
    pill: 'bg-brand-wash text-brand',
  },
  READY_WITH_FIXES: {
    stamp: 'Go, but tidy up',
    line: "Nothing's badly broken, but your numbers will be messy until these are sorted.",
    color: '#B78742',
    pill: 'bg-tan-wash text-[#8a5607]',
  },
  NOT_READY: {
    stamp: "Don't spend yet",
    line: 'Something here will burn money or lie to you about results. Fix it first.',
    color: VIZ.red,
    pill: 'bg-[#d03b3b]/10 text-[#a32c2c]',
  },
};

const SEVERITY_WORD = { High: 'serious', Medium: 'middling', Low: 'minor' };

export default function BusinessView({ report, onSeeDetail }) {
  const v = VERDICT[report.verdict] || VERDICT.READY_WITH_FIXES;
  const log = report.networkLog || [];

  /* ---------- derived numbers ---------- */

  const counts = useMemo(() => {
    const c = { High: 0, Medium: 0, Low: 0 };
    report.issues.forEach((i) => {
      c[i.severity] = (c[i.severity] || 0) + 1;
    });
    return c;
  }, [report.issues]);

  const delivery = useMemo(() => {
    const failed = log.filter((h) => h.failure || (h.status && h.status >= 400)).length;
    const total = log.length || 1;
    return { failed, delivered: log.length - failed, lostPct: Math.round((failed / total) * 100) };
  }, [log]);

  /** Per-platform delivery, worst first -- "which of my ad platforms is blind?" */
  const platforms = useMemo(() => {
    const m = new Map();
    log.forEach((h) => {
      if (!m.has(h.vendorLabel)) m.set(h.vendorLabel, { label: h.vendorLabel, ok: 0, failed: 0 });
      const row = m.get(h.vendorLabel);
      if (h.failure || (h.status && h.status >= 400)) row.failed += 1;
      else row.ok += 1;
    });
    return [...m.values()]
      .map((r) => ({ ...r, note: r.failed ? `${r.failed} never arrived` : null }))
      .sort((a, b) => b.failed - a.failed || b.ok - a.ok);
  }, [log]);

  /** Naming quality: can the ad platforms understand what they are being sent? */
  const naming = useMemo(() => {
    const named = log.filter((h) => h.eventName);
    const standard = new Set();
    const custom = new Set();
    named.forEach((h) => (h.isStandardEvent ? standard : custom).add(`${h.vendorId}:${h.eventName}`));
    return { standard: standard.size, custom: custom.size };
  }, [log]);

  /** The shopper's journey, and whether each step reached an ad platform. */
  const funnel = useMemo(() => {
    const has = (re, phase) =>
      log.filter((h) => h.eventName && re.test(h.eventName) && (!phase || h.phase === phase));
    const pv = has(/page_view|PageView/i);
    const vi = has(/view_item|ViewContent/i);
    const atc = log.filter((h) => h.isConversion && h.phase === 'add_to_cart');
    return [
      { label: 'Saw the page', count: pv.length, reached: pv.length > 0 },
      { label: 'Looked at the product', count: vi.length, reached: vi.length > 0 },
      {
        label: 'Added to cart',
        count: atc.length,
        reached: atc.length > 0,
        tip: report.navigation?.addToCart?.clicked
          ? undefined
          : 'The add-to-cart button could not be clicked, so this step was never tested.',
      },
    ];
  }, [log, report.navigation]);

  const topIssues = useMemo(
    () =>
      [...report.issues]
        .filter((i) => i.severity === 'High')
        .sort((a, b) => (b.businessRisk || '').length - (a.businessRisk || '').length)
        .slice(0, 4),
    [report.issues]
  );

  const passed = (report.checks || []).filter((c) => c.status === 'pass').length;
  const totalChecks = (report.checks || []).length;

  return (
    <div className="space-y-5">
      {/* ---------- Verdict hero ---------- */}
      <section className="overflow-hidden rounded-4xl bg-surface shadow-card ring-1 ring-hair">
        <div className="grid gap-8 p-8 sm:p-10 md:grid-cols-[1fr_auto] md:items-center">
          <div className="min-w-0">
            <span
              className={`inline-flex rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${v.pill}`}
            >
              {v.stamp}
            </span>
            <h1 className="mt-5 text-[32px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[38px]">
              {report.headline || v.line}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-muted">{v.line}</p>
            <p className="mt-5 truncate text-[13px] text-ink-faint">
              {report.targetUrl}
            </p>
          </div>
          <Gauge
            value={report.readinessScore}
            color={v.color}
            label="Readiness score"
            sublabel={`${passed} of ${totalChecks} checks passed`}
          />
        </div>

        {report.executiveSummary && (
          <div className="border-t border-hair bg-plane/60 px-8 py-6 sm:px-10">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              In plain English
            </p>
            <p className="text-[15px] leading-relaxed text-ink">{report.executiveSummary}</p>
          </div>
        )}
      </section>

      {/* ---------- The three headline numbers ---------- */}
      <div className="grid gap-5 md:grid-cols-3">
        <Panel
          title="Is your data arriving?"
          caption="Every tracking request the page tried to send, and how many made it."
        >
          <Donut
            data={[
              { label: 'Arrived', value: delivery.delivered, color: VIZ.blue },
              { label: 'Lost', value: delivery.failed, color: VIZ.red },
            ]}
            centerValue={`${100 - delivery.lostPct}%`}
            centerLabel="arrived"
          />
          {delivery.failed > 0 && (
            <p className="mt-4 rounded-2xl bg-[#d03b3b]/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink">
              <span className="font-semibold">{delivery.lostPct}% of your tracking never
              reached the platform.</span>{' '}
              That share of your traffic is invisible to reporting and to automated bidding.
            </p>
          )}
        </Panel>

        <Panel
          title="How bad is it?"
          caption="Findings by how much each one costs you."
        >
          <Donut
            data={[
              { label: 'Serious', value: counts.High, color: VIZ.sev.High },
              { label: 'Middling', value: counts.Medium, color: VIZ.sev.Medium },
              { label: 'Minor', value: counts.Low, color: VIZ.sev.Low },
            ].filter((d) => d.value > 0)}
            centerValue={report.issues.length}
            centerLabel="findings"
          />
          <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Serious</span> means money gets wasted or
            sales go unrecorded. Deal with those before launch.
          </p>
        </Panel>

        <Panel
          title="Can the platforms read your events?"
          caption="Google and Meta only optimise towards names they recognise."
        >
          <Donut
            data={[
              { label: 'Recognised', value: naming.standard, color: VIZ.blue },
              { label: 'Made-up names', value: naming.custom, color: VIZ.red },
            ].filter((d) => d.value > 0)}
            centerValue={naming.standard + naming.custom}
            centerLabel="event types"
          />
          {naming.custom > 0 && (
            <p className="mt-4 rounded-2xl bg-[#d03b3b]/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink">
              <span className="font-semibold">{naming.custom} event names mean nothing to the
              ad platforms.</span>{' '}
              They can be reported on, but they cannot be optimised towards.
            </p>
          )}
        </Panel>
      </div>

      {/* ---------- Funnel ---------- */}
      <Panel
        title="Does the shopper's journey get recorded?"
        caption="We loaded the page, scrolled it, and clicked add to cart — then checked whether each step actually reached an ad platform. The last step is the one that trains your bidding."
      >
        <Funnel stages={funnel} />
        {!funnel[2].reached && (
          <p className="mt-5 rounded-2xl bg-[#d03b3b]/[0.06] px-4 py-3 text-[13px] leading-relaxed text-ink">
            <span className="font-semibold">Nothing recorded the add to cart.</span> Google and
            Meta learn who is worth showing ads to from exactly this signal. Without it they are
            optimising blind, and your cost per sale will drift upwards.
          </p>
        )}
      </Panel>

      {/* ---------- Platform health ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Which platforms are getting your data?"
          caption="Anything with red is partly blind to what happens on this page."
        >
          <StackedBarList
            rows={platforms}
            series={[
              { key: 'ok', label: 'arrived', color: VIZ.blue },
              { key: 'failed', label: 'lost', color: VIZ.red },
            ]}
          />
        </Panel>

        <Panel
          title="What we checked"
          caption="Eight fixed checks run on every page. Same answer every time — no AI involved in these."
        >
          <div className="space-y-2.5">
            {(report.checks || []).map((c) => {
              const ok = c.status === 'pass';
              const na = c.status === 'not_applicable';
              return (
                <div
                  key={c.id}
                  className="flex items-start gap-3 rounded-2xl px-3 py-2.5"
                  style={{ background: ok ? 'transparent' : na ? 'transparent' : '#d03b3b0f' }}
                >
                  <span
                    className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: ok ? '#2D7A2B' : na ? '#CFCABD' : VIZ.red }}
                    aria-hidden
                  >
                    {ok ? '✓' : na ? '–' : '✕'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink">
                      {c.label}{' '}
                      <span
                        className="text-[12px] font-semibold"
                        style={{ color: ok ? '#175615' : na ? '#848482' : VIZ.red }}
                      >
                        {ok ? 'fine' : na ? "couldn't test" : 'problem'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{c.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* ---------- What it costs ---------- */}
      {topIssues.length > 0 && (
        <Panel
          title="What these problems cost you"
          caption="The serious findings, in money terms rather than network terms."
        >
          <div className="space-y-3">
            {topIssues.map((i) => (
              <div key={i.id} className="rounded-2xl bg-plane px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
                    style={{ background: VIZ.sev[i.severity] }}
                  >
                    {SEVERITY_WORD[i.severity]}
                  </span>
                  {i.affectedMetric && (
                    <span className="text-[12px] text-ink-muted">hits your {i.affectedMetric}</span>
                  )}
                </div>
                <p className="mt-2.5 text-[15px] font-semibold leading-snug text-ink">{i.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
                  {i.businessRisk || i.detail}
                </p>
                {i.recommendedFix && (
                  <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink">
                    <span className="font-semibold">Fix: </span>
                    {i.recommendedFix}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------- Next steps ---------- */}
      {report.recommendedNextSteps?.length > 0 && (
        <Panel title="Do these first" caption="Most urgent at the top.">
          <ol className="space-y-3">
            {report.recommendedNextSteps.map((s, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white tnum">
                  {i + 1}
                </span>
                <span className="pt-1 text-[14px] leading-relaxed text-ink">{s}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="flex justify-center pb-4 pt-2">
        <button
          type="button"
          onClick={onSeeDetail}
          className="rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-white transition hover:bg-ink/85"
        >
          See the technical detail
        </button>
      </div>
    </div>
  );
}
