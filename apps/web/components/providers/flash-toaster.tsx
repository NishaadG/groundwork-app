"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

import { Toaster } from "@/components/ui/primitives";
import { takeFlash } from "@/lib/flash";

/** Shows a pending one-shot notice (see lib/flash.ts) on pages outside the app. */
export function FlashToaster() {
  const t = useTranslations("common.flash");
  useEffect(() => {
    const key = takeFlash();
    if (key) toast(t(key));
  }, [t]);
  return <Toaster />;
}
