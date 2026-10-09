import { useTranslations } from "next-intl";

import { SiteFooter } from "@/components/layout/site-footer";
import { FlashToaster } from "@/components/providers/flash-toaster";
import { SiteHeader } from "@/components/layout/site-header";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-button bg-cell px-4 py-2 text-on-cell focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <FlashToaster />
    </>
  );
}
