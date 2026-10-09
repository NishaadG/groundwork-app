import type { Metadata } from "next";

import { AppShell } from "@/components/features/app/app-shell";
import { AuthGate } from "@/components/features/app/auth-gate";
import { AppProviders } from "@/components/providers/app-providers";
import { ClientMessages } from "@/components/providers/client-messages";

export const metadata: Metadata = { robots: { index: false } };

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientMessages namespaces={["app", "onboarding", "settings", "solar", "water", "waste", "societyPage", "reportsPage", "copilotPage"]}>
      <AppProviders>
        <AppShell>
          <AuthGate requireOnboarded>{children}</AuthGate>
        </AppShell>
      </AppProviders>
    </ClientMessages>
  );
}
