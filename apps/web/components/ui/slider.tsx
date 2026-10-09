"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** Accessible name for each thumb (Radix puts role="slider" on the thumb). */
  thumbLabel: string;
  /** Spoken value, e.g. "2.5 kilowatts". */
  valueText?: (value: number) => string;
};

export function Slider({ className, thumbLabel, valueText, ...props }: SliderProps) {
  const values = props.value ?? props.defaultValue ?? [props.min ?? 0];
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-11 w-full touch-none items-center select-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-concrete">
        <SliderPrimitive.Range className="absolute h-full bg-cell" />
      </SliderPrimitive.Track>
      {values.map((v, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={thumbLabel}
          aria-valuetext={valueText?.(v)}
          className="block size-6 cursor-grab rounded-full border-2 border-cell bg-parapet transition-colors active:cursor-grabbing hover:bg-limewash"
        />
      ))}
    </SliderPrimitive.Root>
  );
}
