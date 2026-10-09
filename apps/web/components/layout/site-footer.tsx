import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand/wordmark";
import { Link } from "@/i18n/navigation";

export function SiteFooter() {
  const t = useTranslations("footer");
  const tn = useTranslations("nav");
  const columns = [
    {
      title: t("product"),
      links: [
        { href: "/how-it-works", label: tn("howItWorks") },
        { href: "/methodology", label: tn("methodology") },
        { href: "/signup", label: tn("getStarted") },
      ],
    },
    {
      title: t("company"),
      links: [
        { href: "/about", label: tn("about") },
        { href: "/recyclers", label: t("recyclers") },
        { href: "/login", label: tn("signIn") },
      ],
    },
    {
      title: t("legal"),
      links: [
        { href: "/privacy", label: t("privacy") },
        { href: "/terms", label: t("terms") },
      ],
    },
  ];
  return (
    <footer className="mt-32 border-t border-concrete bg-parapet">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-16 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <Wordmark />
          <p className="mt-4 max-w-sm text-sm text-cell-muted">{t("tagline")}</p>
          <p className="mt-6 type-small text-cell-muted">{t("builtOnAws")}</p>
        </div>
        {columns.map((col) => (
          <div key={col.title} className="md:col-span-2">
            <h2 className="type-ui text-sm text-cell">{col.title}</h2>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-cell-muted hover:text-cell hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-concrete">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 type-small text-cell-muted sm:px-6 md:flex-row md:justify-between">
          <p>{t("notAffiliated")}</p>
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
