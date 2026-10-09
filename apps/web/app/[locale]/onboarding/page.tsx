import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Onboarding } from "@/components/features/onboarding/onboarding";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "onboarding" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <Onboarding />;
}
