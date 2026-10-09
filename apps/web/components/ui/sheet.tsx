"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Sheets and dialogs share one primitive. Radius 20px with the ink-tinted shadow
 *; on mobile the bottom sheet rounds only its top corners.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

type Side = "bottom" | "right" | "center";

const sideClasses: Record<Side, string> = {
  bottom:
    "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-sheet data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down",
  right:
    "inset-y-0 right-0 w-full max-w-md rounded-l-sheet max-sm:inset-x-0 max-sm:top-auto max-sm:max-h-[88dvh] max-sm:rounded-l-none max-sm:rounded-t-sheet data-[state=open]:animate-sheet-up data-[state=closed]:animate-sheet-down",
  center:
    "left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-sheet data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
};

export function SheetContent({
  side = "bottom",
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: Side; closeLabel: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#0b1020]/45 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col overflow-y-auto bg-parapet text-cell shadow-sheet outline-none",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 inline-flex size-10 cursor-pointer items-center justify-center rounded-button text-cell-muted hover:bg-cell/6 hover:text-cell"
          aria-label={closeLabel}
        >
          <X aria-hidden strokeWidth={1.75} className="size-5" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-6 pt-6 pr-16 pb-2", className)} {...props} />;
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("type-heading text-xl", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("mt-1 text-sm text-cell-muted", className)}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-6 pb-8", className)} {...props} />;
}
