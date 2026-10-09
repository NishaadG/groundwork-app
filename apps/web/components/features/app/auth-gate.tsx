"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useProfile } from "@/components/features/app/use-profile";
import { useAuth } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { usePathname, useRouter } from "@/i18n/navigation";
import { ApiFailure } from "@/lib/api";

/**
 * Protects signed-in routes: signed-out visitors go to /login?next=…,
 * and accounts that haven't finished onboarding go to /onboarding.
 */
export function AuthGate({
  children,
  requireOnboarded,
}: {
  children: React.ReactNode;
  requireOnboarded: boolean;
}) {
  const t = useTranslations("app");
  const { state } = useAuth();
  const profile = useProfile();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === "signed_out") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [state.status, pathname, router]);

  useEffect(() => {
    if (requireOnboarded && profile.data && !profile.data.onboarding_done) {
      router.replace("/onboarding");
    }
  }, [requireOnboarded, profile.data, router]);

  if (state.status !== "signed_in" || profile.isPending) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-4 p-6" role="status" aria-label={t("loading")}>
        <Skeleton className="h-10 w-2/3 max-w-md" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (profile.isError) {
    const notConfigured =
      profile.error instanceof ApiFailure && profile.error.code === "api_not_configured";
    return (
      <div className="mx-auto max-w-md p-6 pt-24" role="alert">
        <p className="type-heading text-xl">{notConfigured ? t("apiNotConfigured") : t("loadError")}</p>
        {!notConfigured && (
          <Button className="mt-6" onClick={() => void profile.refetch()}>
            {t("retry")}
          </Button>
        )}
      </div>
    );
  }

  if (requireOnboarded && !profile.data.onboarding_done) return null;
  return <>{children}</>;
}
