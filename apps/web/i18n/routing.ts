import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "hi", "mr"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];

/**
 * Locales whose UI strings are complete and natively reviewed.
 * Others still route (falling back to English) but aren't offered in the switcher.
 */
export const PUBLISHED_LOCALES: readonly Locale[] = ["en"];

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
};
