import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type Resource = "energy" | "water" | "waste";

const RESOURCE_SWATCH: Record<Resource, string> = {
  energy: "bg-sun",
  water: "bg-tank",
  waste: "bg-kraft",
};

/** A resource label: the resource's colour as a swatch, text stays ink (AA). */
export function ResourceTag({ resource, children, className }: { resource: Resource; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 type-small text-cell-muted", className)}>
      <span aria-hidden className={cn("size-2.5 rounded-[2px]", RESOURCE_SWATCH[resource])} />
      {children}
    </span>
  );
}

/** Designed empty state: an illustration, one sentence, one action. */
export function EmptyState({
  art,
  title,
  body,
  action,
  className,
}: {
  art?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-4 rounded-panel border border-dashed border-concrete-strong bg-parapet/60 p-6 sm:flex-row sm:items-center", className)}>
      {art && <div className="w-28 shrink-0">{art}</div>}
      <div className="min-w-0 flex-1">
        <p className="type-heading text-lg">{title}</p>
        {body && <p className="mt-1 text-cell-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/** Numbered steps for real sequences only (onboarding). */
export function Stepper({
  steps,
  current,
  label,
}: {
  steps: string[];
  current: number;
  label: string;
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex gap-2">
        {steps.map((s, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s} className="flex-1" aria-current={state === "current" ? "step" : undefined}>
              <div className={cn("h-1 rounded-full", state === "todo" ? "bg-concrete" : "bg-cell")} />
              <p className={cn("mt-2 flex items-center gap-1 type-small", state === "todo" ? "text-cell-muted" : "text-cell")}>
                {state === "done" && <Check aria-hidden className="size-3.5" strokeWidth={2} />}
                <span className="truncate">{s}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
