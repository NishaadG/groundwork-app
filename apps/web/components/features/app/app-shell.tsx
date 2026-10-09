"use client";

import { Building2, Droplet, FileText, Home, LogOut, Menu, MessageCircle, Recycle, ScanLine, Settings, Sun, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand/wordmark";
import { useProfile } from "@/components/features/app/use-profile";
import { useAuth } from "@/components/providers/app-providers";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/primitives";
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { setFlash } from "@/lib/flash";
import { cn } from "@/lib/utils";

/**
 * Modules appear in navigation only once they fully work.
 * Flip `enabled` as each phase ships.
 */
type NavKey = "home" | "solar" | "water" | "waste" | "copilot" | "society" | "reports";
const MODULES: { key: NavKey; href: string; icon: LucideIcon; enabled: boolean }[] = [
  { key: "home", href: "/app", icon: Home, enabled: true },
  { key: "solar", href: "/app/solar", icon: Sun, enabled: true },
  { key: "water", href: "/app/water", icon: Droplet, enabled: true },
  { key: "waste", href: "/app/waste", icon: Recycle, enabled: true },
  { key: "copilot", href: "/app/copilot", icon: MessageCircle, enabled: true },
  { key: "society", href: "/app/society", icon: Building2, enabled: true },
  { key: "reports", href: "/app/reports", icon: FileText, enabled: true },
];
const NAV = MODULES.filter((m) => m.enabled);
/** Modules with their own tab on mobile; the rest live under More. */
const TAB_KEYS: NavKey[] = ["home", "copilot"];

/** Scan targets, likewise enabled per phase. */
const SCANS = [
  { key: "bill", href: "/app/solar/new", enabled: true, rule: "bg-sun" },
  { key: "meter", href: "/app/water", enabled: true, rule: "bg-tank" },
  { key: "waste", href: "/app/waste", enabled: true, rule: "bg-kraft" },
].filter((s) => s.enabled);

const SCAN_COPY = {
  bill: { title: "scanBill", body: "scanBillBody" },
  meter: { title: "scanMeter", body: "scanMeterBody" },
  waste: { title: "scanWaste", body: "scanWasteBody" },
} as const;

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

function AccountMenu() {
  const t = useTranslations("app");
  const { state, signOut } = useAuth();
  const profile = useProfile();
  const router = useRouter();
  const name = profile.data?.name ?? state.user?.email ?? "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-pointer rounded-full" aria-label={t("account")}>
        <Avatar name={name || "?"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{state.user?.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/settings")}>
          <Settings aria-hidden strokeWidth={1.75} />
          {t("nav.settings")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            setFlash("signedOut");
            await signOut();
            router.replace("/");
          }}
        >
          <LogOut aria-hidden strokeWidth={1.75} />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScanSheet() {
  const t = useTranslations("app");
  const tc = useTranslations("common");
  if (SCANS.length === 0) return null;
  return (
    <Sheet>
      <SheetTrigger className="flex flex-1 cursor-pointer flex-col items-center justify-end gap-1 pt-2 pb-2 type-small">
        <span className="flex size-11 items-center justify-center rounded-full bg-cell text-on-cell">
          <ScanLine aria-hidden strokeWidth={1.75} className="size-5" />
        </span>
        {t("nav.scan")}
      </SheetTrigger>
      <SheetContent side="bottom" closeLabel={tc("close")}>
        <SheetHeader>
          <SheetTitle>{t("scanTitle")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <ul className="divide-y divide-concrete border-y border-concrete">
            {SCANS.map((s) => (
              <li key={s.key}>
                <SheetClose asChild>
                  <Link href={s.href} className="flex items-center gap-3 py-4">
                    <span aria-hidden className={cn("h-8 w-1 rounded-full", s.rule)} />
                    <span>
                      <span className="block type-heading text-lg">
                        {t(SCAN_COPY[s.key as keyof typeof SCAN_COPY].title)}
                      </span>
                      <span className="text-sm text-cell-muted">
                        {t(SCAN_COPY[s.key as keyof typeof SCAN_COPY].body)}
                      </span>
                    </span>
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("app");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const { signOut } = useAuth();
  const router = useRouter();

  const tab = (k: NavKey) =>
    NAV.filter((n) => n.key === k).map(({ key, href, icon: Icon }) => (
      <li key={key} className="flex flex-1">
        <Link
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className="flex flex-1 flex-col items-center justify-end gap-1 pt-2 pb-2 type-small text-cell-muted aria-[current=page]:text-cell"
        >
          <Icon aria-hidden strokeWidth={1.75} className="size-5" />
          {t(`nav.${key}`)}
        </Link>
      </li>
    ));
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr] md:bg-[linear-gradient(to_right,var(--parapet)_15rem,var(--concrete)_15rem,var(--concrete)_calc(15rem+1px),transparent_calc(15rem+1px))] print:block print:bg-none">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col print:!hidden border-r border-concrete bg-parapet px-4 py-5 md:flex">
        <Link href="/app" className="-m-2 p-2" aria-label={t("nav.home")}>
          <Wordmark />
        </Link>
        <nav aria-label={t("nav.label")} className="mt-8">
          <ul className="space-y-1">
            {NAV.map(({ key, href, icon: Icon }) => (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={isActive(pathname, href) ? "page" : undefined}
                  className="flex items-center gap-3 rounded-button px-3 py-2.5 type-ui text-sm text-cell-muted hover:bg-limewash hover:text-cell aria-[current=page]:bg-limewash aria-[current=page]:text-cell"
                >
                  <Icon aria-hidden strokeWidth={1.75} className="size-[1.1rem]" />
                  {t(`nav.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto">
          <Link
            href="/app/settings"
            aria-current={pathname.startsWith("/app/settings") ? "page" : undefined}
            className="flex items-center gap-3 rounded-button px-3 py-2.5 type-ui text-sm text-cell-muted hover:bg-limewash hover:text-cell aria-[current=page]:bg-limewash aria-[current=page]:text-cell"
          >
            <Settings aria-hidden strokeWidth={1.75} className="size-[1.1rem]" />
            {t("nav.settings")}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-3 border-b border-concrete bg-limewash/92 px-4 backdrop-blur-sm sm:px-6">
          <Link href="/app" className="-m-2 p-2 md:hidden" aria-label={t("nav.home")}>
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <AccountMenu />
          </div>
        </header>

        <main id="main" className="flex-1 px-4 pt-6 pb-28 sm:px-6 md:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav
        aria-label={t("nav.label")}
        className="fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-concrete bg-parapet pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex items-stretch">
          {tab("home")}
          {SCANS.length > 0 && (
            <li className="flex flex-1">
              <ScanSheet />
            </li>
          )}
          {tab("copilot")}
          <li className="flex flex-1">
            <Sheet>
              <SheetTrigger className="flex flex-1 cursor-pointer flex-col items-center justify-end gap-1 pt-2 pb-2 type-small text-cell-muted">
                <Menu aria-hidden strokeWidth={1.75} className="size-5" />
                {t("nav.more")}
              </SheetTrigger>
              <SheetContent side="bottom" closeLabel={tc("close")}>
                <SheetHeader>
                  <SheetTitle>{t("nav.more")}</SheetTitle>
                </SheetHeader>
                <SheetBody>
                  <ul className="divide-y divide-concrete border-y border-concrete">
                    {[...NAV.filter((n) => !TAB_KEYS.includes(n.key)), { key: "settings" as const, href: "/app/settings" }].map((item) => (
                      <li key={item.key}>
                        <SheetClose asChild>
                          <Link href={item.href} className="block py-4 type-heading text-lg">
                            {t(`nav.${item.key}`)}
                          </Link>
                        </SheetClose>
                      </li>
                    ))}
                    <li>
                      <SheetClose asChild>
                        <button
                          type="button"
                          className="block w-full cursor-pointer py-4 text-left type-heading text-lg"
                          onClick={async () => {
                            setFlash("signedOut");
                            await signOut();
                            router.replace("/");
                          }}
                        >
                          {t("signOut")}
                        </button>
                      </SheetClose>
                    </li>
                  </ul>
                </SheetBody>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto mb-8 flex max-w-[1200px] flex-wrap items-end justify-between gap-4", className)}>
      <h1 className="type-display text-3xl sm:text-4xl">{title}</h1>
      {children}
    </div>
  );
}
