"use client";

import { useLocale } from "next-intl";
import { useState } from "react";

import { columnPath, niceTicks, useWidth } from "@/components/charts/chart-frame";
import { formatNumber } from "@/lib/format";

const H = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };

/** One column per bill (single series: the title names it, so no legend box). */
export function BillsChart({
  points,
  title,
  unitLabel,
  color = "var(--chart-use)",
  reference,
}: {
  points: { label: string; value: number }[];
  title: string;
  unitLabel: string;
  color?: string;
  /** A labelled horizontal rule, e.g. the benchmark for this household */
  reference?: { value: number; label: string };
}) {
  const lang = useLocale();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), reference?.value ?? 0, 1));
  const top = ticks[ticks.length - 1]!;
  const innerW = Math.max(width - PAD.left - PAD.right, 0);
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / Math.max(points.length, 1);
  const bar = Math.min(24, Math.max(band - 8, 4));
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const fmt = (v: number) => formatNumber(Math.round(v), lang);

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
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setActive((a) => (a === null ? 0 : Math.min(a + 1, points.length - 1)));
            if (e.key === "ArrowLeft") setActive((a) => (a === null ? points.length - 1 : Math.max(a - 1, 0)));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--cell-muted)">
                {fmt(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = PAD.left + band * i + band / 2;
            return (
              <g key={`${p.label}-${i}`} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
                <path
                  d={columnPath(cx - bar / 2, y(p.value), bar, PAD.top + innerH - y(p.value))}
                  fill={color}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
                {(points.length <= 8 || i % 2 === 0) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--cell-muted)">
                    {p.label}
                  </text>
                )}
                <rect x={cx - band / 2} y={PAD.top} width={band} height={innerH + PAD.bottom} fill="transparent" />
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--concrete-strong)" strokeWidth={1} />
          {reference && (
            <g>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--cell)" strokeWidth={1} opacity={0.55} />
              <text x={width - PAD.right} y={y(reference.value) - 6} textAnchor="end" fontSize={11} fill="var(--cell-muted)">
                {reference.label}
              </text>
            </g>
          )}
          {/* label the latest value directly */}
          {points.length > 0 && (
            <text
              x={PAD.left + band * (points.length - 1) + band / 2}
              y={y(points[points.length - 1]!.value) - 6}
              textAnchor="middle"
              fontSize={11}
              className="type-number"
              fill="var(--cell)"
            >
              {fmt(points[points.length - 1]!.value)}
            </text>
          )}
        </svg>
      )}
      {active !== null && points[active] && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 rounded-input border border-concrete bg-parapet px-3 py-2 shadow-sheet"
          style={{ left: Math.min(Math.max(PAD.left + band * active + band / 2 - 70, 0), Math.max(width - 140, 0)), width: 140 }}
        >
          <p className="type-small text-cell-muted">{points[active].label}</p>
          <p className="type-number text-sm">
            {fmt(points[active].value)} <span className="type-small font-normal text-cell-muted">{unitLabel}</span>
          </p>
        </div>
      )}
    </div>
  );
}
