"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { type WorkingStep, WorkingSteps } from "@/components/features/working/working-steps";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/**
 * The global "How we calculated this" drawer. It renders the calc's
 * own `working` trace, filtered to the steps behind one number.
 */
export function HowCalculated({ steps, title }: { steps: WorkingStep[]; title?: string }) {
  const t = useTranslations("common");
  return (
    <Sheet>
      <SheetTrigger className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap type-small max-sm:text-[0.75rem] text-cell-muted underline decoration-concrete-strong underline-offset-4 hover:text-cell hover:decoration-cell">
        <Info aria-hidden className="size-3.5" strokeWidth={1.75} />
        {t("howCalculated")}
      </SheetTrigger>
      <SheetContent side="right" closeLabel={t("close")} className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title ?? t("howCalculated")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <WorkingSteps steps={steps} className="mt-4" />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
