import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageIntro, Prose } from "@/components/layout/page";
import { CONTACT_EMAIL } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "aboutPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("aboutPage");
  return (
    <>
      <PageIntro title={t("title")} />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <Prose className="text-lg [&_p:first-child]:mt-0">
          <p>{t("p1")}</p>
          <p>{t("p2")}</p>
          <p>{t("p3")}</p>
          <p className="!text-cell-muted">{t("nameNote")}</p>
          {CONTACT_EMAIL && (
            <>
              <h2>{t("contactTitle")}</h2>
              <p>
                {t.rich("contactBody", {
                  address: CONTACT_EMAIL,
                  email: (chunks) => (
                    <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </>
          )}
        </Prose>
      </div>
    </>
  );
}
