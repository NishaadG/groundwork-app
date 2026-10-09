"use client";

import {
  Avatar as AvatarPrimitive,
  DropdownMenu as DropdownPrimitive,
  Progress as ProgressPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import * as React from "react";
import { Toaster as Sonner } from "sonner";

import { cn } from "@/lib/utils";

/* Tabs: an underline on the active tab, no pills */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-6 overflow-x-auto border-b border-concrete", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px cursor-pointer border-b-2 border-transparent py-3 type-ui text-sm whitespace-nowrap text-cell-muted hover:text-cell data-[state=active]:border-cell data-[state=active]:text-cell",
        className,
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;

/* Tooltip: supplementary only, never the sole carrier of information */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-input bg-cell px-3 py-2 text-sm text-on-cell data-[state=delayed-open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/* Switch */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-field bg-concrete transition-colors data-[state=checked]:border-cell data-[state=checked]:bg-cell disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-parapet transition-transform duration-150 data-[state=checked]:translate-x-[1.3rem]" />
    </SwitchPrimitive.Root>
  );
}

/* Progress: a thin instrument bar */
export function Progress({
  className,
  value,
  tone = "ink",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { tone?: "ink" | "sun" | "tank" | "kraft" }) {
  const fill = { ink: "bg-cell", sun: "bg-sun", tank: "bg-tank", kraft: "bg-kraft" }[tone];
  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-concrete", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full transition-transform duration-[400ms] ease-[cubic-bezier(.2,.7,.2,1)]", fill)}
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

/* Skeleton: used instead of spinners on blank pages */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-input bg-concrete/70 motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/* Avatar */
export function Avatar({ className, src, name }: { className?: string; src?: string; name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <AvatarPrimitive.Root
      className={cn("inline-flex size-9 shrink-0 overflow-hidden rounded-full border border-concrete bg-limewash", className)}
    >
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center type-ui text-sm" delayMs={src ? 400 : 0}>
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/* Dropdown menu */
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 rounded-[14px] border border-concrete bg-parapet p-1.5 text-cell shadow-sheet data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-2 rounded-input px-3 py-2 text-base outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-limewash [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DropdownPrimitive.Separator className={cn("my-1.5 h-px bg-concrete", className)} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownPrimitive.Label>) {
  return <DropdownPrimitive.Label className={cn("px-3 py-2 type-small text-cell-muted", className)} {...props} />;
}

/* Toasts: "Reading saved" style confirmations */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(92vw,26rem)] items-start gap-3 rounded-[14px] border border-concrete bg-parapet px-4 py-3 text-cell shadow-sheet",
          title: "type-ui text-sm",
          description: "text-sm text-cell-muted",
          error: "border-alert",
          actionButton: "ml-auto type-ui text-sm underline underline-offset-4",
        },
      }}
    />
  );
}
