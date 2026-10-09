"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Title, chart, table toggle and source line (charts have a table fallback). */
export function ChartFrame({
  title,
  source,
  tableLabel,
  chartLabel,
  table,
  legend,
  children,
  className,
}: {
  title: string;
  source?: string;
  tableLabel: string;
  chartLabel: string;
  table: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={cn("rounded-panel border border-concrete bg-parapet p-4 sm:p-6", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <span className="type-heading text-lg">{title}</span>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="cursor-pointer type-small text-cell-muted underline underline-offset-4 hover:text-cell print:hidden"
        >
          {asTable ? chartLabel : tableLabel}
        </button>
      </figcaption>
      {legend && !asTable && <div className="mt-3">{legend}</div>}
      <div className="mt-4">{asTable ? (
          <div tabIndex={0} role="region" aria-label={title} className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell">
            {table}
          </div>
        ) : (
          children
        )}</div>
      {source && <p className="mt-3 type-small text-cell-muted">{source}</p>}
    </figure>
  );
}

export function LegendItem({ color, label, shape = "rect" }: { color: string; label: string; shape?: "rect" | "line" }) {
  return (
    <span className="inline-flex items-center gap-1.5 type-small text-cell-muted">
      {shape === "rect" ? (
        <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: color }} />
      ) : (
        <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}

/** Measures an element's width so SVG charts draw at real pixels (crisp 1px rules, fixed text). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Rounded top corners only (4px data-end, square at the baseline). */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Clean axis ticks: 0, step, 2·step… with step from {1,2,2.5,5}×10ⁿ. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}
