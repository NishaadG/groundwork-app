"use client";

import { motion, useReducedMotion } from "motion/react";

/** Side-view kit pieces for Water and Waste. Props drive the drawing. */

const EASE = [0.2, 0.7, 0.2, 1] as const;

export function Tank({
  fillPct,
  title,
  className,
}: {
  fillPct: number;
  title: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, fillPct));
  const top = 24;
  const bottom = 164;
  const level = bottom - ((bottom - top) * pct) / 100;
  return (
    <svg viewBox="0 0 160 190" role="img" aria-label={title} className={className}>
      <defs>
        <clipPath id="tank-inside">
          <path d="M28 24 H132 L136 164 Q80 176 24 164 Z" />
        </clipPath>
      </defs>
      <path d="M28 24 H132 L136 164 Q80 176 24 164 Z" fill="var(--tank-body)" />
      <motion.rect
        x={20}
        width={120}
        height={180}
        fill="var(--tank)"
        clipPath="url(#tank-inside)"
        initial={false}
        animate={{ y: level }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE }}
      />
      {[60, 100, 140].map((y) => (
        <line key={y} x1={24} x2={136} y1={y} y2={y} stroke="var(--parapet)" strokeWidth={0.75} opacity={0.25} />
      ))}
      <path d="M28 24 H132 L136 164 Q80 176 24 164 Z" fill="none" stroke="var(--cell)" strokeWidth={1.5} />
      <rect x={56} y={10} width={48} height={14} rx={2} fill="var(--tank-body)" stroke="var(--cell)" strokeWidth={1.5} />
      <line x1={10} x2={150} y1={180} y2={180} stroke="var(--cell)" strokeWidth={1.5} />
    </svg>
  );
}

export function Meter({
  reading,
  title,
  className,
}: {
  /** Digits shown on the odometer wheels, e.g. "004821". The last two are red fractions. */
  reading: string;
  title: string;
  className?: string;
}) {
  const digits = reading.padStart(6, "0").slice(-6).split("");
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={title} className={className}>
      <circle cx={100} cy={100} r={88} fill="var(--parapet)" stroke="var(--cell)" strokeWidth={1.5} />
      <circle cx={100} cy={100} r={76} fill="none" stroke="var(--concrete)" strokeWidth={1} />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={100 + Math.cos(a) * 70}
            y1={100 + Math.sin(a) * 70}
            x2={100 + Math.cos(a) * 76}
            y2={100 + Math.sin(a) * 76}
            stroke="var(--cell)"
            strokeWidth={1}
          />
        );
      })}
      <rect x={34} y={78} width={132} height={30} rx={3} fill="var(--cell)" />
      {digits.map((d, i) => (
        <g key={i}>
          <rect
            x={38 + i * 21.3}
            y={81}
            width={18}
            height={24}
            rx={1.5}
            fill={i >= 4 ? "var(--alert)" : "var(--parapet)"}
          />
          <text
            x={47 + i * 21.3}
            y={99}
            textAnchor="middle"
            className="type-number"
            fontSize={17}
            fill={i >= 4 ? "#ffffff" : "var(--cell)"}
          >
            {d}
          </text>
        </g>
      ))}
      <circle cx={100} cy={142} r={14} fill="none" stroke="var(--tank)" strokeWidth={1.5} />
      <path d="M100 142 L110 134" stroke="var(--tank)" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function Sack({
  fillPct,
  title,
  className,
}: {
  fillPct: number;
  title: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, fillPct));
  const level = 176 - (140 * pct) / 100;
  const outline = "M40 40 Q34 110 30 172 Q90 186 150 172 Q146 110 140 40 Q90 30 40 40 Z";
  return (
    <svg viewBox="0 0 180 200" role="img" aria-label={title} className={className}>
      <defs>
        <clipPath id="sack-inside">
          <path d={outline} />
        </clipPath>
      </defs>
      <path d={outline} fill="var(--parapet)" />
      <motion.rect
        x={20}
        width={140}
        height={200}
        fill="var(--kraft)"
        clipPath="url(#sack-inside)"
        initial={false}
        animate={{ y: level }}
        transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE }}
      />
      {/* jute weave */}
      <g clipPath="url(#sack-inside)" stroke="var(--cell)" strokeWidth={0.6} opacity={0.18}>
        {Array.from({ length: 14 }, (_, i) => (
          <line key={`a${i}`} x1={20 + i * 11} x2={20 + i * 11} y1={30} y2={190} />
        ))}
        {Array.from({ length: 15 }, (_, i) => (
          <line key={`b${i}`} x1={20} x2={160} y1={30 + i * 11} y2={30 + i * 11} />
        ))}
      </g>
      <path d={outline} fill="none" stroke="var(--cell)" strokeWidth={1.5} />
      <path d="M40 40 Q90 52 140 40" fill="none" stroke="var(--cell)" strokeWidth={1.5} />
      <path d="M78 36 Q90 18 102 36" fill="none" stroke="var(--cell)" strokeWidth={1.5} />
    </svg>
  );
}
