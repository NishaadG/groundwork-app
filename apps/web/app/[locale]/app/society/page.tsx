import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SocietyPage } from "@/components/features/society/society-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "societyPage" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return (
    <Suspense>
      <SocietyPage />
    </Suspense>
  );
}
