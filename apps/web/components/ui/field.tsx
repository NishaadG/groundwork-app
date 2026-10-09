import { Label as LabelPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Inputs: 6px radius, 1px border that meets 3:1 contrast (WCAG 1.4.11). */
export const inputClasses =
  "h-11 w-full min-w-0 rounded-input border border-field bg-parapet px-3 text-base text-cell placeholder:text-cell-muted/80 transition-colors hover:border-cell focus-visible:border-cell focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cell disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-alert";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return <input type={type} className={cn(inputClasses, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(inputClasses, "h-auto min-h-24 py-2.5", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn("type-ui text-sm text-cell", className)} {...props} />;
}

/**
 * Label + control + hint + error, wired with ids so screen readers announce all of it.
 * Pass a single control element as the child; it receives id/aria props.
 */
export function Field({
  label,
  hint,
  error,
  id,
  className,
  optionalLabel,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  id: string;
  className?: string;
  optionalLabel?: string;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {optionalLabel && <span className="type-small text-cell-muted">{optionalLabel}</span>}
      </div>
      {React.cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint && (
        <p id={hintId} className="type-small text-cell-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="type-small text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
