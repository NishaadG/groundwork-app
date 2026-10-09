import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { NewReport } from "@/components/features/solar/new-report";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "solar.new" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <NewReport />;
}
