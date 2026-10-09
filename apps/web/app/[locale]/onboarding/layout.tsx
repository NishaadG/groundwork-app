import type { Metadata } from "next";

import { Wordmark } from "@/components/brand/wordmark";
import { AuthGate } from "@/components/features/app/auth-gate";
import { AppProviders } from "@/components/providers/app-providers";
import { ClientMessages } from "@/components/providers/client-messages";

export const metadata: Metadata = { robots: { index: false } };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages namespaces={["app", "onboarding"]}>
      <AppProviders>
        <header className="border-b border-concrete">
          <div className="mx-auto flex h-16 max-w-2xl items-center px-4">
            <Wordmark />
          </div>
        </header>
        <main id="main" className="px-4 py-10 pb-24">
          <AuthGate requireOnboarded={false}>{children}</AuthGate>
        </main>
      </AppProviders>
    </ClientMessages>
  );
}
