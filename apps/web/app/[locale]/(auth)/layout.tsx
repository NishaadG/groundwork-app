import { getTranslations } from "next-intl/server";

import { Terrace } from "@/components/brand/terrace";
import { Wordmark } from "@/components/brand/wordmark";
import { AppProviders } from "@/components/providers/app-providers";
import { ClientMessages } from "@/components/providers/client-messages";
import { Link } from "@/i18n/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("auth");
  const tn = await getTranslations("nav");
  return (
    <ClientMessages namespaces={["auth"]}>
      <AppProviders>
        <div className="grid min-h-dvh lg:grid-cols-2">
          <div className="flex flex-col px-4 py-6 sm:px-10">
            <Link href="/" className="-m-2 self-start p-2" aria-label={tn("home")}>
              <Wordmark />
            </Link>
            <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
              {children}
            </main>
          </div>
          <aside className="hidden flex-col justify-center gap-8 border-l border-concrete bg-parapet p-12 lg:flex">
            <Terrace panels={6} title={t("artTitle")} className="mx-auto h-auto w-full max-w-lg" />
            <p className="mx-auto max-w-sm text-center type-heading text-xl text-cell-muted">{t("aside")}</p>
          </aside>
        </div>
      </AppProviders>
    </ClientMessages>
  );
}
