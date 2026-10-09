import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SharedReportPage } from "@/components/features/solar/solar-pages";
import { AppProviders } from "@/components/providers/app-providers";
import { ClientMessages } from "@/components/providers/client-messages";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "solar.shared" });
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <ClientMessages namespaces={["solar"]}>
      <AppProviders>
        <SharedReportPage token={token} />
      </AppProviders>
    </ClientMessages>
  );
}
