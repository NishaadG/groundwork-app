import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { CopilotPage } from "@/components/features/copilot/copilot-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "copilotPage" });
  return { title: t("metaTitle") };
}

export default function Page() {
  return <CopilotPage />;
}
