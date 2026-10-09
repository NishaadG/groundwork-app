import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SolarList } from "@/components/features/solar/solar-pages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "solar" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <SolarList />;
}
