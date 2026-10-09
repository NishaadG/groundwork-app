import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";

const NAV = [
  { href: "/how-it-works", key: "howItWorks" },
  { href: "/methodology", key: "methodology" },
  { href: "/about", key: "about" },
] as const;

export function SiteHeader() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  return (
    <header className="sticky top-0 z-30 border-b border-concrete bg-limewash/92 backdrop-blur-sm supports-[backdrop-filter]:bg-limewash/80">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="-m-2 p-2" aria-label={t("home")}>
          <Wordmark />
        </Link>
        <nav aria-label={t("label")} className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-input px-3 py-2 text-sm type-ui text-cell-muted hover:text-cell"
                >
                  {t(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
          <Button asChild size="sm" className="h-10 rounded-button px-4">
            <Link href="/signup">{t("getStarted")}</Link>
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label={tc("openMenu")}>
                <Menu aria-hidden strokeWidth={1.75} />
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" closeLabel={tc("close")}>
              <SheetHeader>
                <SheetTitle>{tc("menu")}</SheetTitle>
              </SheetHeader>
              <SheetBody>
                <nav aria-label={t("label")}>
                  <ul className="divide-y divide-concrete border-y border-concrete">
                    {[...NAV, { href: "/login", key: "signIn" } as const].map((item) => (
                      <li key={item.href}>
                        <SheetClose asChild>
                          <Link href={item.href} className="block py-4 type-heading text-lg">
                            {t(item.key)}
                          </Link>
                        </SheetClose>
                      </li>
                    ))}
                  </ul>
                </nav>
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
