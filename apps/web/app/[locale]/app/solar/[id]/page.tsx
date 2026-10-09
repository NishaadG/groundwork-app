import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SolarReportPage } from "@/components/features/solar/solar-pages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "solar.report" });
  return { title: t("metaTitle") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SolarReportPage id={id} />;
}
