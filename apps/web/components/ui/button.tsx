import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Primary buttons are always ink: colour means data, not "click me".
 * No hover animation; hover changes colour only. Labels are plain verbs, no arrows.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap type-ui rounded-button transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[1.1em] [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-cell text-on-cell hover:bg-cell/88",
        secondary: "border border-field bg-parapet text-cell hover:border-cell",
        ghost: "text-cell hover:bg-cell/6",
        link: "text-cell underline decoration-concrete-strong underline-offset-4 hover:decoration-cell rounded-none",
        danger: "bg-alert text-on-cell hover:bg-alert/90",
      },
      size: {
        sm: "h-9 px-3 text-sm rounded-input",
        md: "h-11 px-5 text-sm",
        lg: "h-13 px-6 text-base",
        icon: "size-11",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
