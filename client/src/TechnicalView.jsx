import React, { useMemo, useState } from 'react';
import { Panel, TimelineStrip, VIZ } from './charts.jsx';

/**
 * TechnicalView.jsx -- everything needed to actually fix the tags.
 *
 * Statuses, selectors, account ids, payload fingerprints, the raw event log. This
 * is also where provenance is spelled out: MEASURED findings carry the exact rule
 * that produced them, AI findings say plainly that a model judged the impact.
 */

const PROVENANCE = {
  deterministic: {
    tag: 'MEASURED',
    badge: 'bg-ink text-white',
    blurb:
      "A fixed rule checked this against what the browser actually saw. Re-run the audit and you'll get the same answer.",
  },
  gemini: {
    tag: 'AI',
    badge: 'bg-[#5b4ac4] text-white',
    blurb:
      'Gemini read those measurements and judged the business impact. It never decides what fired — only what it means.',
  },
};

const SEV = {
  High: { word: 'serious', color: VIZ.sev.High },
  Medium: { word: 'middling', color: VIZ.sev.Medium },
  Low: { word: 'minor', color: VIZ.sev.Low },
};

const PHASES = [
  { key: 'load', label: 'page load' },
  { key: 'consent', label: 'cookie banner' },
  { key: 'scroll', label: 'scrolling' },
  { key: 'add_to_cart', label: 'add to cart' },
  { key: 'settle', label: 'after click' },
];

function Mark({ source }) {
  const p = PROVENANCE[source] || PROVENANCE.deterministic;
  return (
    <span
      title={p.blurb}
      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${p.badge}`}
    >
      {p.tag}
    </span>
  );
}

function Finding({ issue, check }) {
  const [open, setOpen] = useState(false);
  const sev = SEV[issue.severity] || SEV.Low;
  const isAI = issue.source === 'gemini';

  return (
    <div className={`rounded-2xl ${isAI ? 'bg-[#5b4ac4]/[0.04]' : 'bg-plane'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left"
      >
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: sev.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Mark source={issue.source} />
            <span className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: sev.color }}>
              {sev.word}
            </span>
          </span>
          <span className="mt-2 block text-[15px] font-semibold leading-snug text-ink">
            {issue.title}
          </span>
          <span className="mt-1.5 block text-[13.5px] leading-relaxed text-ink-muted">
            {issue.businessRisk || issue.detail}
          </span>
        </span>
        <span className="mt-1 shrink-0 text-[12px] font-medium text-ink-faint">
          {open ? 'Hide' : 'Proof'}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-hair px-5 py-4 text-[13.5px]">
          {issue.recommendedFix && (
            <p className="leading-relaxed text-ink">
              <span className="font-semibold">Fix: </span>
              {issue.recommendedFix}
            </p>
          )}
          {issue.businessRisk && issue.detail && (
            <p className="leading-relaxed text-ink-muted">
              <span className="font-semibold text-ink">Observed: </span>
              {issue.detail}
            </p>
          )}
          <div className="rounded-2xl bg-surface px-4 py-3 ring-1 ring-hair">
            <div className="mb-1.5 flex items-center gap-2">
              <Mark source={issue.source} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {isAI ? 'how Gemini got here' : 'the rule applied'}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              {isAI ? PROVENANCE.gemini.blurb : check?.method}
            </p>
          </div>
          {issue.evidence?.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                requests captured
              </p>
              <ul className="space-y-1.5">
                {issue.evidence.map((e, i) => (
                  <li
                    key={i}
                    className="break-all rounded-xl bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-muted ring-1 ring-hair"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TechnicalView({ report }) {
  const [sevFilter, setSevFilter] = useState('All');
  const [srcFilter, setSrcFilter] = useState('All');

  const checksById = useMemo(
    () => Object.fromEntries((report.checks || []).map((c) => [c.id, c])),
    [report.checks]
  );

  const events = useMemo(
    () => (report.networkLog || []).filter((h) => h.eventName),
    [report.networkLog]
  );

  const issues = useMemo(() => {
    let list = report.issues;
    if (sevFilter !== 'All') list = list.filter((i) => i.severity === sevFilter);
    if (srcFilter !== 'All') list = list.filter((i) => i.source === srcFilter);
    const order = { High: 0, Medium: 1, Low: 2 };
    return [...list].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [report.issues, sevFilter, srcFilter]);

  const pill = (active, label, onClick) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
        active ? 'bg-ink text-white' : 'bg-plane text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* ---------- Session facts ---------- */}
      <Panel title="The session" caption="What the browser did, and what it saw.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            ['Page response', `HTTP ${report.navigation?.status ?? '—'}`],
            ['Session length', `${(report.durationMs / 1000).toFixed(1)}s`],
            ['Tracking requests', report.summary.totalTrackingRequests],
            ['Events parsed', report.summary.totalEvents],
            ['Vendors detected', report.summary.vendorsDetected],
            ['Failed requests', report.summary.failedTrackingRequests],
            ['Duplicate payloads', report.summary.duplicateHits],
            ['Non-standard names', report.summary.customEventNames],
          ].map(([k, val]) => (
            <div key={k}>
              <dt className="text-[12px] text-ink-faint">{k}</dt>
              <dd className="tnum mt-0.5 text-[17px] font-semibold text-ink">{val}</dd>
            </div>
          ))}
        </dl>
        {report.navigation?.addToCart && (
          <p className="mt-5 rounded-2xl bg-plane px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-muted">
            add-to-cart: {report.navigation.addToCart.detail}
          </p>
        )}
      </Panel>

      {/* ---------- Timeline ---------- */}
      <Panel
        title="When each event fired"
        caption="Grouped by what the browser was doing at the time. This is what lets the audit say a click produced no conversion, rather than just that one is missing."
      >
        <TimelineStrip events={events} phases={PHASES} duration={report.durationMs} />
      </Panel>

      {/* ---------- Checklist with rules ---------- */}
      {report.checks?.length > 0 && (
        <Panel
          title="The checks, and the exact rule each applies"
          caption="No model involved in any of these. Open one to see the rule."
        >
          <div className="space-y-2">
            {report.checks.map((c) => {
              const ok = c.status === 'pass';
              const na = c.status === 'not_applicable';
              return (
                <details key={c.id} className="group rounded-2xl bg-plane">
                  <summary className="flex cursor-pointer items-start gap-3 px-5 py-3.5">
                    <span
                      className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: ok ? '#2D7A2B' : na ? '#CFCABD' : VIZ.red }}
                      aria-hidden
                    >
                      {ok ? '✓' : na ? '–' : '✕'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-[14px] font-medium text-ink">
                        {c.label}{' '}
                        <span
                          className="text-[12px] font-semibold"
                          style={{ color: ok ? '#175615' : na ? '#848482' : VIZ.red }}
                        >
                          {ok ? 'fine' : na ? "couldn't test" : 'problem'}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">
                        {c.detail}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-[12px] font-medium text-ink-faint group-open:hidden">
                      Rule
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-hair px-5 py-4">
                    <p className="text-[13.5px] text-ink">
                      <span className="font-semibold">Really asking: </span>
                      {c.question}
                    </p>
                    <p className="text-[13px] leading-relaxed text-ink-muted">
                      <span className="font-semibold text-ink">The rule: </span>
                      {c.method}
                    </p>
                  </div>
                </details>
              );
            })}
          </div>
        </Panel>
      )}

      {/* ---------- Findings ---------- */}
      <Panel
        title={`Every finding — ${report.issues.length}`}
        caption="MEASURED came from a fixed rule. AI is Gemini's read on what it costs. Open any one for the proof."
      >
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {[
            ['All', 'all'],
            ['High', 'serious'],
            ['Medium', 'middling'],
            ['Low', 'minor'],
          ].map(([val, lbl]) => pill(sevFilter === val, lbl, () => setSevFilter(val)))}
          <span className="mx-1 h-4 w-px bg-hair" />
          {[
            ['All', 'both'],
            ['deterministic', 'measured'],
            ['gemini', 'ai'],
          ].map(([val, lbl]) => pill(srcFilter === val, lbl, () => setSrcFilter(val)))}
        </div>

        {issues.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">
            Nothing matches those filters.
          </p>
        ) : (
          <div className="space-y-2.5">
            {issues.map((i) => (
              <Finding key={i.id} issue={i} check={checksById[i.checkId]} />
            ))}
          </div>
        )}
      </Panel>

      {/* ---------- Vendors ---------- */}
      <Panel
        title="Tags detected on the wire"
        caption="Account IDs as observed. More than one ID for a vendor means data is being split."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {report.vendorInventory.map((v) => (
            <div key={v.vendorId} className="rounded-2xl bg-plane px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-medium text-ink">{v.label}</span>
                <span className="tnum text-[12px] text-ink-faint">{v.hits} hits</span>
              </div>
              {v.accountIds.length > 0 && (
                <p className="mt-2 break-all font-mono text-[11px] leading-relaxed text-ink-muted">
                  {v.accountIds.join('  ')}
                  {v.accountIds.length > 1 && (
                    <span className="ml-1.5 font-sans font-medium" style={{ color: VIZ.red }}>
                      — {v.accountIds.length} accounts
                    </span>
                  )}
                </p>
              )}
              {v.events.length > 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
                  {v.events.slice(0, 6).join(' · ')}
                  {v.events.length > 6 && ` +${v.events.length - 6}`}
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* ---------- Event naming ---------- */}
      {report.eventTaxonomy?.length > 0 && (
        <Panel
          title="Event naming"
          caption="Whether a name is standard is measured; what it means and what it should be is Gemini's read."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="border-b border-hair text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="py-2.5 pr-5 font-semibold">Sent</th>
                  <th className="py-2.5 pr-5 font-semibold">To</th>
                  <th className="py-2.5 pr-5 font-semibold">Which is</th>
                  <th className="py-2.5 pr-5 font-semibold">Meaning</th>
                  <th className="py-2.5 font-semibold">Should be</th>
                </tr>
              </thead>
              <tbody>
                {report.eventTaxonomy.map((t, i) => (
                  <tr key={`${t.observedName}-${i}`} className="border-b border-hair align-top">
                    <td className="whitespace-nowrap py-3 pr-5 font-mono text-[11.5px] text-ink">
                      {t.observedName}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-5 text-ink-muted">{t.vendor}</td>
                    <td className="whitespace-nowrap py-3 pr-5 text-[12px] text-ink-muted">
                      {t.category.replace(/_/g, ' ')}
                    </td>
                    <td className="w-full py-3 pr-5 leading-relaxed text-ink-muted">
                      {t.businessMeaning}
                    </td>
                    <td className="whitespace-nowrap py-3 font-mono text-[11.5px]">
                      {t.suggestedName !== t.observedName ? (
                        <span style={{ color: '#175615' }}>{t.suggestedName}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ---------- Duplicates ---------- */}
      {report.duplicates?.length > 0 && (
        <Panel
          title="Duplicate payloads"
          caption="Identical fingerprint seen more than once — the same message counted twice."
        >
          <div className="space-y-2">
            {report.duplicates.map((d) => (
              <div
                key={d.fingerprint}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-2xl bg-plane px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] text-ink">
                    {d.vendorLabel} <span className="font-mono">{d.eventName}</span>
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    +{d.timestampsMs.join('ms  +')}ms · fp {d.fingerprint}
                  </p>
                </div>
                <span
                  className="tnum shrink-0 text-[12.5px] font-semibold"
                  style={{ color: d.isConversion ? VIZ.red : VIZ.sev.Medium }}
                >
                  {d.count}× {d.isConversion && '· conversion'}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* ---------- Raw log ---------- */}
      <Panel title={`Raw event log — ${events.length}`} caption="Everything parsed off the wire.">
        <div className="max-h-[420px] overflow-auto rounded-2xl ring-1 ring-hair">
          <table className="min-w-full font-mono text-[11.5px]">
            <thead className="sticky top-0 bg-surface text-left text-ink-faint">
              <tr className="border-b border-hair">
                <th className="px-3 py-2.5 font-semibold">When</th>
                <th className="px-3 py-2.5 font-semibold">Phase</th>
                <th className="px-3 py-2.5 font-semibold">Vendor</th>
                <th className="px-3 py-2.5 font-semibold">Event</th>
                <th className="px-3 py-2.5 font-semibold">Result</th>
                <th className="px-3 py-2.5 font-semibold">Account</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const bad = e.failure || (e.status && e.status >= 400);
                return (
                  <tr key={e.id} className="border-b border-hair last:border-0">
                    <td className="tnum px-3 py-2 text-ink-faint">+{e.tMs}ms</td>
                    <td className="px-3 py-2 text-ink-muted">{e.phase}</td>
                    <td className="px-3 py-2 text-ink-muted">{e.vendorLabel}</td>
                    <td className="px-3 py-2 text-ink">{e.eventName}</td>
                    <td className="px-3 py-2" style={{ color: bad ? VIZ.red : '#86868B' }}>
                      {e.failure || e.status || '—'}
                    </td>
                    <td className="px-3 py-2 text-ink-faint">{e.accountId || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {report.pageErrors?.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              JavaScript errors on the page
            </p>
            <ul className="space-y-1.5">
              {report.pageErrors.map((e, i) => (
                <li
                  key={i}
                  className="break-all rounded-xl bg-plane px-3 py-2 font-mono text-[11px] text-ink-muted"
                >
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <p className="pb-6 text-center font-mono text-[11px] leading-relaxed text-ink-faint">
        Run {report.runId || '—'} · {(report.checks || []).length} rules over{' '}
        {report.summary.totalTrackingRequests} requests, then handed to Gemini.
        <br />
        Captured by driving a real browser at the page, not by reading its source.
      </p>
    </div>
  );
}
