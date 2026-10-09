import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { PageIntro, Prose } from "@/components/layout/page";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "termsPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("termsPage");
  const format = await getFormatter();
  return (
    <>
      <PageIntro title={t("title")}>
        <p className="mt-4 type-small text-cell-muted">
          {t("updated", { date: format.dateTime(new Date(LEGAL_UPDATED), { dateStyle: "long" }) })}
        </p>
      </PageIntro>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <Prose className="[&_h2:first-child]:mt-0">
          {[1, 2, 3, 4, 5].map((n) => (
            <section key={n}>
              <h2>{t(`p${n}Title` as "p1Title")}</h2>
              <p>{t(`p${n}` as "p1")}</p>
            </section>
          ))}
          {CONTACT_EMAIL && (
            <p className="mt-12">
              {t.rich("contact", {
                address: CONTACT_EMAIL,
                  email: (chunks) => (
                    <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
                      {chunks}
                    </a>
                  ),
              })}
            </p>
          )}
        </Prose>
      </div>
    </>
  );
}
