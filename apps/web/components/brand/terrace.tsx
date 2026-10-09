"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The terrace, seen from above: whitewashed parapet, the black
 * overhead tank, the stair headroom, a clothesline, and solar panels that lay down
 * as the system size changes. Flat, 1.5px ink outlines, limewash/concrete fills.
 */

const EASE = [0.2, 0.7, 0.2, 1] as const;

/** Panels drawn per kW. Illustrative only (≈ two 500 W modules per kW). */
export const PANELS_PER_KW = 2;

const VIEW_W = 480;
const VIEW_H = 340;
// Panel field: the open part of the roof, right of the tank and stair block
const FIELD = { x: 176, y: 44, cols: 5, rows: 2, w: 50, h: 92, gapX: 8, gapY: 34 };
export const MAX_PANELS = FIELD.cols * FIELD.rows;

export function panelSlots(count: number) {
  const slots: { x: number; y: number; i: number }[] = [];
  for (let i = 0; i < Math.min(count, MAX_PANELS); i++) {
    const row = Math.floor(i / FIELD.cols);
    const col = i % FIELD.cols;
    slots.push({
      i,
      x: FIELD.x + col * (FIELD.w + FIELD.gapX),
      y: FIELD.y + row * (FIELD.h + FIELD.gapY),
    });
  }
  return slots;
}

function Panel({ x, y }: { x: number; y: number }) {
  const { w, h } = FIELD;
  return (
    <g>
      {/* low-angle shadow from the mounting tilt */}
      <rect x={x + 3} y={y + h - 2} width={w - 2} height={9} fill="var(--cell)" opacity={0.12} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1.5}
        fill="var(--panel-cell)"
        stroke="var(--cell)"
        strokeWidth={1.5}
      />
      {[1, 2].map((c) => (
        <line
          key={`c${c}`}
          x1={x + (w / 3) * c}
          x2={x + (w / 3) * c}
          y1={y + 2}
          y2={y + h - 2}
          stroke="var(--panel-cell-line)"
          strokeWidth={0.75}
        />
      ))}
      {[1, 2, 3, 4, 5].map((r) => (
        <line
          key={`r${r}`}
          x1={x + 2}
          x2={x + w - 2}
          y1={y + (h / 6) * r}
          y2={y + (h / 6) * r}
          stroke="var(--panel-cell-line)"
          strokeWidth={0.75}
        />
      ))}
    </g>
  );
}

export function Terrace({
  panels,
  intro = false,
  className,
  title,
}: {
  /** Number of panels to show (0–MAX_PANELS). */
  panels: number;
  /** Play the one orchestrated landing moment: parapet draws in, panels lay down. */
  intro?: boolean;
  className?: string;
  title: string;
}) {
  const reduce = useReducedMotion();
  const animateIntro = intro && !reduce;
  const slots = panelSlots(panels);

  const draw = (delay: number) =>
    animateIntro
      ? {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { duration: 0.5, delay, ease: EASE },
        }
      : {};

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={title}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* roof slab */}
      <rect x={8} y={8} width={VIEW_W - 16} height={VIEW_H - 16} fill="var(--parapet)" />
      {/* floor tiles, very faint */}
      <g stroke="var(--concrete)" strokeWidth={0.75} opacity={0.7}>
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} x1={24 + i * 40} x2={24 + i * 40} y1={24} y2={VIEW_H - 24} />
        ))}
        {Array.from({ length: 8 }, (_, i) => (
          <line key={`h${i}`} x1={24} x2={VIEW_W - 24} y1={24 + i * 40} y2={24 + i * 40} />
        ))}
      </g>
      {/* parapet: outer and inner wall lines */}
      <motion.rect
        x={8}
        y={8}
        width={VIEW_W - 16}
        height={VIEW_H - 16}
        fill="none"
        stroke="var(--cell)"
        strokeWidth={1.5}
        {...draw(0)}
      />
      <motion.rect
        x={22}
        y={22}
        width={VIEW_W - 44}
        height={VIEW_H - 44}
        fill="none"
        stroke="var(--cell)"
        strokeWidth={1.5}
        {...draw(0.1)}
      />
      {/* stair headroom (mumty) */}
      <motion.g
        initial={animateIntro ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.35, ease: EASE }}
      >
        <rect x={22} y={214} width={112} height={104} fill="var(--concrete)" stroke="var(--cell)" strokeWidth={1.5} />
        {[0, 1, 2, 3, 4].map((s) => (
          <line key={s} x1={40} x2={116} y1={232 + s * 14} y2={232 + s * 14} stroke="var(--cell)" strokeWidth={0.75} opacity={0.5} />
        ))}
        <rect x={60} y={300} width={36} height={18} fill="var(--parapet)" stroke="var(--cell)" strokeWidth={1.5} />
      </motion.g>
      {/* overhead water tank, top view */}
      <motion.g
        initial={animateIntro ? { opacity: 0, scale: 0.9 } : false}
        animate={{ opacity: 1, scale: 1 }}
        style={{ transformOrigin: "86px 92px" }}
        transition={{ duration: 0.3, delay: 0.45, ease: EASE }}
      >
        <circle cx={86} cy={92} r={44} fill="var(--tank-body)" stroke="var(--cell)" strokeWidth={1.5} />
        <circle cx={86} cy={92} r={44} fill="none" stroke="var(--parapet)" strokeWidth={1} opacity={0.25} strokeDasharray="3 9" />
        <circle cx={86} cy={92} r={14} fill="var(--tank-body)" stroke="var(--parapet)" strokeWidth={1.25} opacity={0.9} />
        <path d="M130 92 H150 V40" fill="none" stroke="var(--tank)" strokeWidth={3} strokeLinecap="round" />
      </motion.g>
      {/* clothesline between two posts */}
      <motion.g
        initial={animateIntro ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.5, ease: EASE }}
        stroke="var(--cell)"
      >
        <line x1={176} x2={448} y1={300} y2={300} strokeWidth={0.75} />
        <line x1={176} x2={448} y1={308} y2={308} strokeWidth={0.75} />
        <rect x={172} y={296} width={8} height={16} fill="var(--cell)" strokeWidth={0} />
        <rect x={444} y={296} width={8} height={16} fill="var(--cell)" strokeWidth={0} />
      </motion.g>
      {/* panels */}
      <AnimatePresence initial={animateIntro}>
        {slots.map(({ x, y, i }) => (
          <motion.g
            key={i}
            initial={reduce ? false : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6 }}
            transition={{ duration: 0.24, delay: animateIntro ? 0.65 + i * 0.07 : 0, ease: EASE }}
          >
            <Panel x={x} y={y} />
          </motion.g>
        ))}
      </AnimatePresence>
    </svg>
  );
}
