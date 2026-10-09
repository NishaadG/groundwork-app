import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SocietyReport } from "@/components/features/society/society-report";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "societyPage.report" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <SocietyReport />;
}
