import { cn } from "@/lib/utils";

/**
 * The wordmark: a terrace seen from above (parapet with one panel bay laid) and the
 * name in Anek at expanded width. Ink only; the mark never takes a resource colour.
 */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-cell", className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-6 shrink-0">
        <rect x="1.75" y="1.75" width="20.5" height="20.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <rect x="5" y="5" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="12" y="5" width="7" height="7" fill="currentColor" />
      </svg>
      {!compact && (
        <span
          className="text-[1.3rem] leading-none font-semibold tracking-[-0.01em]"
          style={{ fontVariationSettings: '"wdth" 118' }}
        >
          groundwork
        </span>
      )}
    </span>
  );
}
