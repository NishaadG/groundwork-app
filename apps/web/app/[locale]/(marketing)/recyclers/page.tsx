import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PartnerSignup } from "@/components/features/waste/partner-signup";
import { PageIntro } from "@/components/layout/page";
import { AppProviders } from "@/components/providers/app-providers";
import { ClientMessages } from "@/components/providers/client-messages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "waste.join" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function RecyclersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("waste.join");
  return (
    <>
      <PageIntro title={t("title")} intro={t("intro")} />
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-12">
        <section aria-labelledby="how" className="lg:col-span-4">
          <h2 id="how" className="type-heading text-xl">
            {t("howTitle")}
          </h2>
          <ol className="mt-4 space-y-4">
            {(["how1", "how2", "how3"] as const).map((k, i) => (
              <li key={k} className="flex gap-3 text-sm">
                <span aria-hidden className="type-number text-cell-muted">
                  {i + 1}
                </span>
                {t(k)}
              </li>
            ))}
          </ol>
        </section>
        <div className="lg:col-span-8">
          <ClientMessages namespaces={["waste"]}>
            <AppProviders>
              <PartnerSignup />
            </AppProviders>
          </ClientMessages>
        </div>
      </div>
    </>
  );
}
