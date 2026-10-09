import { useTranslations } from "next-intl";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 md:py-32">
        <h1 className="type-display text-[2.625rem] sm:text-5xl">{t("title")}</h1>
        <p className="mt-4 text-lg text-cell-muted">{t("body")}</p>
        <Button asChild className="mt-8">
          <Link href="/">{t("home")}</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}
