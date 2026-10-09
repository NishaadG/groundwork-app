import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { PageIntro, Prose } from "@/components/layout/page";
import { CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/site";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacyPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacyPage");
  const format = await getFormatter();
  const mail = (chunks: React.ReactNode) => (
    <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
      {chunks}
    </a>
  );
  return (
    <>
      <PageIntro title={t("title")}>
        <p className="mt-4 type-small text-cell-muted">
          {t("updated", { date: format.dateTime(new Date(LEGAL_UPDATED), { dateStyle: "long" }) })}
        </p>
      </PageIntro>
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <Prose>
          <div className="rounded-panel border border-concrete bg-parapet p-5">
            <h2 className="!mt-0">{t("summaryTitle")}</h2>
            <p>{t("summary")}</p>
          </div>
          <h2>{t("storeTitle")}</h2>
          <ul>
            {[1, 2, 3, 4, 5].map((n) => (
              <li key={n}>{t(`store${n}` as "store1")}</li>
            ))}
          </ul>
          <h2>{t("notStoreTitle")}</h2>
          <ul>
            {[1, 2, 3].map((n) => (
              <li key={n}>{t(`notStore${n}` as "notStore1")}</li>
            ))}
          </ul>
          <h2>{t("aiTitle")}</h2>
          <p>{t("aiBody")}</p>
          <h2>{t("shareTitle")}</h2>
          <p>{t("shareBody")}</p>
          <h2>{t("controlTitle")}</h2>
          <p>{t("controlBody")}</p>
          <h2>{t("whereTitle")}</h2>
          <p>{t("whereBody")}</p>
          {CONTACT_EMAIL && (
            <>
              <h2>{t("contactTitle")}</h2>
              <p>{t.rich("contactBody", { address: CONTACT_EMAIL, email: mail })}</p>
            </>
          )}
        </Prose>
      </div>
    </>
  );
}
