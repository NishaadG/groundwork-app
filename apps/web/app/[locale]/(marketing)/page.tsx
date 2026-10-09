import { setRequestLocale } from "next-intl/server";

import { Hero } from "@/components/features/marketing/hero";
import {
  ClosingCta,
  Faq,
  HowItWorksSteps,
  ResourcePanels,
  ShowTheWorking,
  SocietyPreview,
} from "@/components/features/marketing/sections";

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <Hero />
      <ResourcePanels />
      <HowItWorksSteps />
      <ShowTheWorking />
      <SocietyPreview />
      <Faq />
      <ClosingCta />
    </>
  );
}
