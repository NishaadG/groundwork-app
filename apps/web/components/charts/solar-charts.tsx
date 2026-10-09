"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { columnPath, niceTicks, useWidth } from "@/components/charts/chart-frame";
import { formatInr, formatNumber } from "@/lib/format";

const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };

function monthNames(lang: string) {
  const f = new Intl.DateTimeFormat(lang === "en" ? "en-IN" : lang, { month: "short" });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(2026, i, 1)));
}

function Tooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: { label: string; value: string; color: string }[];
}) {
  const w = 168;
  const left = Math.min(Math.max(x - w / 2, 0), Math.max(width - w, 0));
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-input border border-concrete bg-parapet px-3 py-2 shadow-sheet"
      style={{ left, width: w }}
    >
      <p className="type-small text-cell-muted">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: r.color }} />
            <span className="type-number text-sm">{r.value}</span>
            <span className="type-small text-cell-muted">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Grouped monthly columns: the user's use vs solar output (two series, legend + tooltip). */
export function MonthlyChart({
  use,
  gen,
  useLabel,
  genLabel,
  unit,
  title,
}: {
  use: number[];
  gen: number[];
  useLabel: string;
  genLabel: string;
  unit: string;
  title: string;
}) {
  const lang = useLocale();
  const months = monthNames(lang);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...use, ...gen, 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / 12;
  const bar = Math.min(12, Math.max((band - 2 - 6) / 2, 3)); // ≤24px pair, 2px gap
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const fmt = (v: number) => formatNumber(Math.round(v), lang);
  const showEvery = width < 420 ? 2 : 1;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={title}
          tabIndex={0}
          className="block outline-offset-4"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => (a === null ? 0 : Math.min(a + 1, 11)));
            if (e.key === "ArrowLeft") setActive((a) => (a === null ? 11 : Math.max(a - 1, 0)));
            if (e.key === "Escape") setActive(null);
          }}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="type-number" fontSize={11} fill="var(--cell-muted)">
                {fmt(t)}
              </text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = PAD.left + band * i + band / 2;
            const x0 = cx - bar - 1;
            const x1 = cx + 1;
            return (
              <g key={m} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                {active === i && <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH} fill="var(--cell)" opacity={0.05} />}
                <path d={columnPath(x0, y(use[i]!), bar, PAD.top + innerH - y(use[i]!))} fill="var(--chart-use)" />
                <path d={columnPath(x1, y(gen[i]!), bar, PAD.top + innerH - y(gen[i]!))} fill="var(--chart-gen)" />
                {i % showEvery === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--cell-muted)">
                    {m}
                  </text>
                )}
                {/* hit target larger than the marks */}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH + PAD.bottom} fill="transparent" />
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--concrete-strong)" strokeWidth={1} />
        </svg>
      )}
      {active !== null && (
        <Tooltip
          x={PAD.left + band * active + band / 2}
          width={width}
          title={months[active]!}
          rows={[
            { label: `${useLabel} (${unit})`, value: fmt(use[active]!), color: "var(--chart-use)" },
            { label: `${genLabel} (${unit})`, value: fmt(gen[active]!), color: "var(--chart-gen)" },
          ]}
        />
      )}
    </div>
  );
}

/** Cumulative savings over the system's life against what you pay (one series + a reference). */
export function PaybackChart({
  cumulative,
  netCost,
  paybackYears,
  title,
  cumulativeLabel,
  netCostLabel,
  yearLabel,
}: {
  cumulative: number[];
  netCost: number;
  paybackYears: number | null;
  title: string;
  cumulativeLabel: string;
  netCostLabel: string;
  yearLabel: string;
}) {
  const lang = useLocale();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = cumulative.length;
  const ticks = niceTicks(Math.max(...cumulative, netCost, 1));
  const top = ticks[ticks.length - 1]!;
  const left = 64;
  const innerW = Math.max(width - left - PAD.right, 0);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (yr: number) => left + ((yr - 1) / Math.max(n - 1, 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const path = cumulative.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const compact = (v: number) =>
    v >= 1e5 ? `₹${formatNumber(v / 1e5, lang, v >= 1e6 ? 0 : 1)}L` : formatInr(v, lang);

  const onMove = (clientX: number, rect: DOMRect) => {
    const yr = Math.round(((clientX - rect.left - left) / innerW) * (n - 1)) + 1;
    setActive(Math.min(Math.max(yr, 1), n));
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={title}
          tabIndex={0}
          className="block outline-offset-4"
          onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => (a === null ? 1 : Math.min(a + 1, n)));
            if (e.key === "ArrowLeft") setActive((a) => (a === null ? n : Math.max(a - 1, 1)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="type-number" fontSize={11} fill="var(--cell-muted)">
                {compact(t)}
              </text>
            </g>
          ))}
          {[1, 5, 10, 15, 20, 25].filter((yr) => yr <= n).map((yr) => (
            <text key={yr} x={x(yr)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--cell-muted)">
              {yr}
            </text>
          ))}
          {/* What you pay: a reference rule, labelled directly */}
          <line x1={left} x2={width - PAD.right} y1={y(netCost)} y2={y(netCost)} stroke="var(--cell)" strokeWidth={1} strokeDasharray="0" opacity={0.55} />
          <text x={width - PAD.right} y={y(netCost) - 6} textAnchor="end" fontSize={11} fill="var(--cell-muted)">
            {netCostLabel} {compact(netCost)}
          </text>
          <path d={`${path}L${x(n)},${y(0)}L${x(1)},${y(0)}Z`} fill="var(--chart-gen)" opacity={0.1} />
          <path d={path} fill="none" stroke="var(--chart-gen)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {paybackYears !== null && paybackYears <= n && (
            <circle cx={x(Math.max(paybackYears, 1))} cy={y(netCost)} r={4.5} fill="var(--chart-gen)" stroke="var(--parapet)" strokeWidth={2} />
          )}
          {active !== null && (
            <>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--cell)" strokeWidth={1} opacity={0.35} />
              <circle cx={x(active)} cy={y(cumulative[active - 1]!)} r={4.5} fill="var(--chart-gen)" stroke="var(--parapet)" strokeWidth={2} />
            </>
          )}
          <line x1={left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--concrete-strong)" strokeWidth={1} />
        </svg>
      )}
      {active !== null && (
        <Tooltip
          x={x(active)}
          width={width}
          title={`${yearLabel} ${active}`}
          rows={[{ label: cumulativeLabel, value: formatInr(cumulative[active - 1]!, lang), color: "var(--chart-gen)" }]}
        />
      )}
    </div>
  );
}
