import { cn } from "@/lib/utils";

/** Shared page furniture for the marketing pages. Left-aligned, 68ch text measure. */
export function PageIntro({ title, intro, children }: { title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-16 pb-16 sm:px-6 md:pt-24">
      <h1 className="type-display text-[2.625rem] sm:text-5xl lg:text-[4.125rem]">{title}</h1>
      {intro && <p className="mt-6 max-w-[60ch] text-lg text-cell-muted">{intro}</p>}
      {children}
    </div>
  );
}

export function Prose({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-w-[68ch] [&_h2]:mt-12 [&_h2]:type-heading [&_h2]:text-2xl [&_li]:mt-2 [&_p]:mt-4 [&_p]:text-cell [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      {...props}
    />
  );
}
