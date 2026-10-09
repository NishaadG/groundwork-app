"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A big number with its label: the instrument-panel readout.
 * Condensed Anek with tabular figures, so changing values don't jitter.
 * Self-contained (its own <dl>), so any layout can hold it and notes can sit below it.
 */
export function Readout({
  label,
  value,
  tone = "ink",
  size = "md",
  className,
  children,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "ink" | "leaf";
  size?: "sm" | "md" | "lg";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dl>
        <dt className="type-small text-cell-muted">{label}</dt>
        <dd
          className={cn(
            "mt-1 type-number leading-none",
            size === "sm" && "text-xl",
            size === "md" && "text-2xl sm:text-3xl",
            size === "lg" && "text-3xl sm:text-4xl",
            tone === "leaf" ? "text-leaf" : "text-cell",
          )}
        >
          {value}
        </dd>
      </dl>
      {children}
    </div>
  );
}

/** Counts from 0 to `value` once (the landing intro); otherwise shows the value. */
export function CountUp({
  value,
  format,
  play,
  delay = 0,
}: {
  value: number;
  format: (n: number) => string;
  play: boolean;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  // The first render must match the server's, which can't know the motion preference;
  // reduced motion jumps straight to the value in the effect below.
  const [shown, setShown] = useState(play ? 0 : value);
  const played = useRef(false);

  useEffect(() => {
    if (!play || reduce || played.current) {
      setShown(value);
      return;
    }
    played.current = true;
    const controls = animate(0, value, {
      duration: 0.6,
      delay,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: setShown,
    });
    return () => controls.stop();
  }, [value, play, reduce, delay]);

  return <span>{format(shown)}</span>;
}
