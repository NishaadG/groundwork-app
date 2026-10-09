import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Sack, Tank } from "@/components/brand/resource-kit";
import { Terrace } from "@/components/brand/terrace";
import { HowItWorksSteps } from "@/components/features/marketing/sections";
import { PageIntro } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "howItWorksPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function HowItWorksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("howItWorksPage");
  const th = await getTranslations("hero");

  const modules = [
    {
      key: "energy",
      rule: "bg-sun",
      art: <Terrace panels={4} title={th("terraceTitle", { count: 4 })} className="h-auto w-full" />,
    },
    { key: "water", rule: "bg-tank", art: <Tank fillPct={62} title={t("waterTitle")} className="mx-auto h-48 w-auto" /> },
    { key: "waste", rule: "bg-kraft", art: <Sack fillPct={45} title={t("wasteTitle")} className="mx-auto h-48 w-auto" /> },
  ] as const;

  return (
    <>
      <PageIntro title={t("title")} intro={t("intro")} />

      <section aria-labelledby="principles" className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
        <h2 id="principles" className="type-heading text-3xl">
          {t("principlesTitle")}
        </h2>
        <dl className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          {[1, 2, 3].map((n) => (
            <div key={n} className="border-t border-cell pt-5">
              <dt className="type-heading text-xl">{t(`principle${n}Title` as "principle1Title")}</dt>
              <dd className="mt-3 text-cell-muted">{t(`principle${n}Body` as "principle1Body")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <HowItWorksSteps />

      <div className="mx-auto max-w-[1200px] space-y-24 px-4 py-24 sm:px-6">
        {modules.map((m, i) => (
          <section key={m.key} aria-labelledby={`m-${m.key}`} className="grid items-center gap-10 lg:grid-cols-12">
            <div className={cn("lg:col-span-6", i % 2 === 1 && "lg:order-2 lg:col-start-7")}>
              <div className={cn("h-1 w-16", m.rule)} aria-hidden />
              <h2 id={`m-${m.key}`} className="mt-5 type-heading text-3xl">
                {t(`${m.key}Title`)}
              </h2>
              <p className="mt-4 max-w-[60ch] text-lg text-cell-muted">{t(`${m.key}Body`)}</p>
            </div>
            <div
              className={cn(
                "rounded-panel border border-concrete bg-parapet p-6 lg:col-span-5",
                i % 2 === 1 ? "lg:order-1" : "lg:col-start-8",
              )}
            >
              {m.art}
            </div>
          </section>
        ))}
        <p className="max-w-[60ch] border-l-2 border-concrete-strong pl-4 text-cell-muted">{t("alsoNote")}</p>
        <Button asChild size="lg">
          <Link href="/signup">{t("cta")}</Link>
        </Button>
      </div>
    </>
  );
}
