import React, { useState } from 'react';

/**
 * charts.jsx -- hand-rolled SVG chart primitives.
 *
 * No charting library: every form here is a handful of paths, and pulling in a
 * dependency would cost more than it saves.
 *
 * Colour rules these follow, and why they are not negotiable:
 *  - Every hex came out of the dataviz validator against a #FFFFFF surface.
 *  - Severity is ORDINAL, so it uses a single-hue red ramp (light -> dark), not
 *    red/amber/green. A traffic-light scale is the classic colour-blindness trap:
 *    deuteranopes cannot separate green from amber (ΔE 4.3) or amber from red.
 *  - Delivered vs failed uses blue vs red (ΔE 23.8 protan), never green vs red
 *    (ΔE 4.1 protan -- a hard fail as a chart fill).
 *  - Green/red survives only on the pass/fail checklist, where it is always paired
 *    with a tick or cross AND a word. Colour never carries meaning alone.
 *  - Every series is directly labelled, so identity never depends on hue.
 */

export const VIZ = {
  blue: '#2a78d6',       // delivered
  red: '#d03b3b',        // lost
  green: '#2D7A2B',      // Neeman's forest green -- success states, never a split
  sev: { High: '#8f2424', Medium: '#d03b3b', Low: '#e08a8a' },
  grid: '#E5E1D7',
  axis: '#CFCABD',
  track: '#E8E4DA',      // warm track, drawn from Neeman's paper
  tan: '#C7A574',
};

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

export function Panel({ title, caption, children, className = '' }) {
  return (
    <section
      className={`rounded-3xl bg-surface p-6 shadow-card ring-1 ring-hair ${className}`}
    >
      {title && (
        <header className="mb-5">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          {caption && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{caption}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Tooltip that follows the cursor. An SVG chart on a page should be inspectable. */
function useTip() {
  const [tip, setTip] = useState(null);
  const bind = (label) => ({
    onMouseEnter: (e) => setTip({ label, x: e.clientX, y: e.clientY }),
    onMouseMove: (e) => setTip({ label, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setTip(null),
  });
  const node = tip ? (
    <div
      className="pointer-events-none fixed z-50 rounded-lg bg-ink px-2.5 py-1.5 text-[12px] font-medium text-white shadow-lift"
      style={{ left: tip.x + 12, top: tip.y - 8 }}
    >
      {tip.label}
    </div>
  ) : null;
  return { bind, node };
}

export function Legend({ items }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
          {i.value !== undefined && (
            <span className="tnum font-medium text-ink">{i.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Hero gauge -- one number, so it is a figure rather than a chart
 * ------------------------------------------------------------------ */

export function Gauge({ value, max = 100, color, label, sublabel }) {
  const r = 78;
  const cx = 100;
  const cy = 96;
  const circ = Math.PI * r; // semicircle
  const pct = Math.max(0, Math.min(1, value / max));

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 112" className="w-full max-w-[260px]" role="img"
           aria-label={`${label}: ${value} out of ${max}`}>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={VIZ.track}
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.32,0.72,0,1)' }}
        />
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          className="fill-ink"
          style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.02em' }}
        >
          {value}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" className="fill-ink-faint" style={{ fontSize: 12 }}>
          out of {max}
        </text>
      </svg>
      <p className="mt-1 text-[13px] font-medium text-ink">{label}</p>
      {sublabel && <p className="mt-0.5 text-center text-[12px] text-ink-muted">{sublabel}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Donut
 * ------------------------------------------------------------------ */

export function Donut({ data, centerValue, centerLabel, size = 190 }) {
  const { bind, node } = useTip();
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 70;
  const stroke = 22;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg viewBox="0 0 180 180" style={{ width: size, height: size }} role="img">
          <circle cx="90" cy="90" r={r} fill="none" stroke={VIZ.track} strokeWidth={stroke} />
          {data.map((d) => {
            const frac = d.value / total;
            // 2px surface gap between neighbouring fills so segments never merge.
            const len = Math.max(0, c * frac - 3);
            const el = (
              <circle
                key={d.label}
                cx="90"
                cy="90"
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 90 90)"
                className="cursor-default"
                {...bind(`${d.label}: ${d.value} (${Math.round(frac * 100)}%)`)}
              />
            );
            offset += c * frac;
            return el;
          })}
          {centerValue !== undefined && (
            <>
              <text
                x="90"
                y="86"
                textAnchor="middle"
                className="fill-ink"
                style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }}
              >
                {centerValue}
              </text>
              <text x="90" y="106" textAnchor="middle" className="fill-ink-faint" style={{ fontSize: 11 }}>
                {centerLabel}
              </text>
            </>
          )}
        </svg>
        {node}
      </div>
      <Legend items={data.map((d) => ({ label: d.label, color: d.color, value: d.value }))} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal bars
 * ------------------------------------------------------------------ */

export function BarList({ data, unit = '', showZero = true }) {
  const { bind, node } = useTip();
  const max = Math.max(...data.map((d) => d.value), 1);
  const rows = showZero ? data : data.filter((d) => d.value > 0);

  if (!rows.length) {
    return <p className="py-6 text-center text-[13px] text-ink-muted">Nothing to show.</p>;
  }

  return (
    <div className="space-y-3.5">
      {rows.map((d) => (
        <div key={d.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-ink">{d.label}</span>
            <span className="tnum text-[13px] font-semibold text-ink">
              {d.value}
              {unit}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: VIZ.track }}>
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color }}
              {...bind(`${d.label}: ${d.value}${unit}`)}
            />
          </div>
          {d.note && <p className="mt-1 text-[12px] text-ink-muted">{d.note}</p>}
        </div>
      ))}
      {node}
    </div>
  );
}

/** Per-row stacked bar: delivered vs failed, with a 2px gap between fills. */
export function StackedBarList({ rows, series }) {
  const { bind, node } = useTip();
  const max = Math.max(...rows.map((r) => series.reduce((s, k) => s + (r[k.key] || 0), 0)), 1);

  return (
    <div>
      <div className="space-y-3.5">
        {rows.map((r) => {
          const total = series.reduce((s, k) => s + (r[k.key] || 0), 0);
          return (
            <div key={r.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] text-ink">{r.label}</span>
                <span className="tnum shrink-0 text-[13px] text-ink-muted">
                  {total} {total === 1 ? 'request' : 'requests'}
                </span>
              </div>
              <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
                   style={{ background: VIZ.track }}>
                {series.map((k) => {
                  const v = r[k.key] || 0;
                  if (!v) return null;
                  return (
                    <div
                      key={k.key}
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${(v / max) * 100}%`, background: k.color }}
                      {...bind(`${r.label} — ${k.label}: ${v}`)}
                    />
                  );
                })}
              </div>
              {r.note && <p className="mt-1 text-[12px] text-viz-red">{r.note}</p>}
            </div>
          );
        })}
      </div>
      <Legend items={series.map((k) => ({ label: k.label, color: k.color }))} />
      {node}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Funnel -- did the shopper's journey reach the ad platforms?
 * ------------------------------------------------------------------ */

export function Funnel({ stages }) {
  const { bind, node } = useTip();

  return (
    <div>
      <div className="space-y-2">
        {stages.map((s, i) => {
          const width = 100 - i * 14;
          return (
            <div key={s.label} className="flex items-center gap-4">
              <div className="w-36 shrink-0 text-right text-[13px] text-ink">{s.label}</div>
              <div className="relative h-11 flex-1">
                <div
                  className="flex h-full items-center rounded-xl px-3 transition-all duration-700"
                  style={{
                    width: `${width}%`,
                    background: s.reached ? VIZ.blue : VIZ.track,
                    border: s.reached ? 'none' : `1px dashed ${VIZ.axis}`,
                  }}
                  {...bind(s.tip || s.label)}
                >
                  <span
                    className="text-[12px] font-medium"
                    style={{ color: s.reached ? '#fff' : '#86868B' }}
                  >
                    {s.reached ? `${s.count} tracked` : 'nothing recorded'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {node}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Timeline strip -- events over the session, one row per interaction phase
 * ------------------------------------------------------------------ */

export function TimelineStrip({ events, phases, duration }) {
  const { bind, node } = useTip();
  const rowH = 30;
  const h = phases.length * rowH + 22;
  const W = 720;
  const pad = 108;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${h}`} className="min-w-[640px]" role="img"
           aria-label="Tracking events over the session, grouped by what the browser was doing">
        {phases.map((p, i) => (
          <g key={p.key}>
            <line
              x1={pad}
              x2={W - 16}
              y1={i * rowH + 16}
              y2={i * rowH + 16}
              stroke={VIZ.grid}
              strokeWidth="1"
            />
            <text x={pad - 10} y={i * rowH + 20} textAnchor="end" className="fill-ink-muted"
                  style={{ fontSize: 11 }}>
              {p.label}
            </text>
          </g>
        ))}

        {events.map((e) => {
          const row = phases.findIndex((p) => p.key === e.phase);
          if (row < 0) return null;
          const x = pad + ((e.tMs / (duration || 1)) * (W - pad - 24));
          const bad = e.failure || (e.status && e.status >= 400);
          return (
            <circle
              key={e.id}
              cx={x}
              cy={row * rowH + 16}
              r={bad ? 5 : 4}
              fill={bad ? VIZ.red : VIZ.blue}
              stroke="#fff"
              strokeWidth="2"
              className="cursor-default"
              {...bind(
                `+${(e.tMs / 1000).toFixed(1)}s · ${e.vendorLabel} · ${e.eventName}${
                  bad ? ` · ${e.failure || `HTTP ${e.status}`}` : ''
                }`
              )}
            />
          );
        })}

        <line x1={pad} x2={W - 16} y1={h - 14} y2={h - 14} stroke={VIZ.axis} strokeWidth="1" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text
            key={f}
            x={pad + f * (W - pad - 24)}
            y={h - 2}
            textAnchor="middle"
            className="fill-ink-faint tnum"
            style={{ fontSize: 10 }}
          >
            {((duration * f) / 1000).toFixed(0)}s
          </text>
        ))}
      </svg>
      <Legend
        items={[
          { label: 'reached the platform', color: VIZ.blue },
          { label: 'failed on the way', color: VIZ.red },
        ]}
      />
      {node}
    </div>
  );
}
