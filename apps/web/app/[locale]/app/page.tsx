import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AppHome } from "@/components/features/app/home";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.home" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <AppHome />;
}
