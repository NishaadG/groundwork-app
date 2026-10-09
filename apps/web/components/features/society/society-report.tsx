"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { WorkingSteps } from "@/components/features/working/working-steps";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getSociety } from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";

type Metric = "inr" | "kwh" | "litres" | "kg" | "co2_t";
const METRICS: Metric[] = ["inr", "kwh", "litres", "kg", "co2_t"];

function fmt(m: Metric, v: number, lang: string) {
  if (m === "inr") return formatInr(v, lang);
  if (m === "kwh") return `${formatNumber(v, lang)} kWh`;
  if (m === "litres") return `${formatNumber(v, lang)} L`;
  if (m === "kg") return `${formatNumber(v, lang, 1)} kg`;
  return `${formatNumber(v, lang, 2)} t`;
}

/** A printable society impact report: combined totals, participation and the opted-in board. */
export function SocietyReport() {
  const t = useTranslations("societyPage");
  const ti = useTranslations("reportsPage.impact");
  const lang = useLocale();
  const format = useFormatter();
  const q = useQuery({ queryKey: ["society"], queryFn: getSociety });
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-[900px]" />;
  if (q.isError || !q.data) return <p role="alert" className="text-alert">{t("errors.generic")}</p>;
  const s = q.data;
  const realised = METRICS.filter((m) => s.totals.realised[m]);
  const projected = METRICS.filter((m) => s.totals.projected[m]);
  const board = s.leaderboard.filter((r) => r.change_pct !== null).slice(0, 10);

  return (
    <article className="mx-auto max-w-[900px] space-y-10 print:max-w-none print:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/society" className="inline-flex items-center gap-1.5 type-small text-cell-muted hover:text-cell">
          <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
          {t("title")}
        </Link>
        <Button onClick={() => window.print()}>
          <Printer aria-hidden strokeWidth={1.75} />
          {ti("download")}
        </Button>
      </div>

      <header className="border-b-2 border-cell pb-6">
        <p className="type-ui text-sm tracking-wide">groundwork</p>
        <h1 className="mt-2 type-display text-4xl sm:text-5xl">{t("report.title")}</h1>
        <p className="mt-3 text-lg">
          {s.name}, {s.city}
        </p>
        <p className="type-small text-cell-muted">{t("report.generated", { date: format.dateTime(new Date(), { dateStyle: "long" }) })}</p>
        <p className="mt-2 text-sm">
          {t("report.households", { members: s.members, flats: formatNumber(s.flats, lang), pct: formatNumber(s.participation_pct, lang, 1) })}
        </p>
      </header>

      <section aria-labelledby="soc-realised">
        <h2 id="soc-realised" className="type-heading text-2xl">
          {t("report.realisedTitle")}
        </h2>
        {realised.length === 0 ? (
          <p className="mt-2 text-sm text-cell-muted">{t("stats.none")}</p>
        ) : (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {realised.map((m) => (
              <div key={m} className="border-t border-concrete pt-2">
                <dt className="type-small text-cell-muted">{t(`stats.${m}`)}</dt>
                <dd className="type-number text-2xl">{fmt(m, s.totals.realised[m]!, lang)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-sm">{t("report.leaks", { found: s.leaks.found, fixed: s.leaks.fixed })}</p>
      </section>

      {projected.length > 0 && (
        <section aria-labelledby="soc-projected">
          <h2 id="soc-projected" className="type-heading text-2xl">
            {t("report.projectedTitle")}
          </h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {projected.map((m) => (
              <div key={m} className="border-t border-concrete pt-2">
                <dt className="type-small text-cell-muted">{t(`stats.${m}`)}</dt>
                <dd className="type-number text-xl">{fmt(m, s.totals.projected[m]!, lang)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {board.length > 0 && (
        <section aria-labelledby="soc-board">
          <h2 id="soc-board" className="type-heading text-2xl">
            {t("report.boardTitle")}
          </h2>
          <ol className="mt-3 space-y-1 text-sm">
            {board.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex justify-between gap-4 border-b border-dashed border-concrete py-1.5">
                <span>
                  <span className="mr-3 type-number text-cell-muted">{i + 1}</span>
                  {r.name}
                </span>
                <span className="type-number">{`${r.change_pct! > 0 ? "+" : ""}${formatNumber(r.change_pct!, lang, 1)}%`}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="soc-working">
        <h2 id="soc-working" className="type-heading text-2xl">
          {ti("workingTitle")}
        </h2>
        <WorkingSteps steps={s.working} className="mt-4" />
      </section>

      <section aria-labelledby="soc-method">
        <h2 id="soc-method" className="type-heading text-2xl">
          {ti("methodTitle")}
        </h2>
        <p className="mt-2 max-w-[65ch] text-sm">{t("report.method")}</p>
      </section>
    </article>
  );
}
