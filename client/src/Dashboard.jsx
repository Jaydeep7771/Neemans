import React, { useState } from 'react';
import BusinessView from './BusinessView.jsx';
import TechnicalView from './TechnicalView.jsx';

/**
 * Dashboard.jsx -- the shell that splits one audit into two audiences.
 *
 * The same report serves two people who want completely different things:
 *
 *   Overview   the person who signs off the budget. Charts, money consequences,
 *              plain English. No HTTP statuses.
 *   Detail     the person who fixes the tags. Statuses, account ids, fingerprints,
 *              the raw log, and the exact rule behind every measured finding.
 *
 * Splitting them beats one long page, because the technical detail was drowning the
 * answer for the reader who only needs the answer.
 */

const TABS = [
  { id: 'business', label: 'Overview', hint: 'for the budget owner' },
  { id: 'technical', label: 'Detail', hint: 'for whoever fixes it' },
];

export default function Dashboard({ report }) {
  const [tab, setTab] = useState('business');

  return (
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-6 sm:px-6">
      {/* Segmented control, iOS style */}
      <div className="mb-6 flex justify-center">
        <div
          role="tablist"
          aria-label="Report view"
          className="inline-flex gap-1 rounded-full bg-plane p-1 ring-1 ring-hair"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-full px-5 py-2 text-[13.5px] font-medium transition ${
                  active
                    ? 'bg-surface text-ink shadow-card'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {t.label}
                <span className="ml-2 hidden text-[12px] font-normal text-ink-faint sm:inline">
                  {t.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'business' ? (
        <BusinessView report={report} onSeeDetail={() => setTab('technical')} />
      ) : (
        <TechnicalView report={report} />
      )}
    </div>
  );
}
