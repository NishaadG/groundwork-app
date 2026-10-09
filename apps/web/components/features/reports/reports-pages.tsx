"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { PageHeader } from "@/components/features/app/app-shell";
import { HowCalculated } from "@/components/features/working/how-calculated";
import { WorkingSteps } from "@/components/features/working/working-steps";
import { EmptyState } from "@/components/ui/blocks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getReports, type ImpactReport } from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Metric = "inr" | "kwh" | "litres" | "kg" | "co2_t";
const METRICS: Metric[] = ["inr", "kwh", "litres", "kg", "co2_t"];

function fmtMetric(m: Metric, v: number, lang: string) {
  if (m === "inr") return formatInr(v, lang);
  if (m === "kwh") return `${formatNumber(v, lang)} kWh`;
  if (m === "litres") return `${formatNumber(v, lang)} L`;
  if (m === "kg") return `${formatNumber(v, lang, 1)} kg`;
  return `${formatNumber(v, lang, 2)} t`;
}

const GRADE_TONE: Record<string, string> = { A: "text-leaf", B: "text-leaf", C: "text-cell", D: "text-alert", E: "text-alert" };

export function ReportsPage() {
  const t = useTranslations("reportsPage");
  const lang = useLocale();
  const format = useFormatter();
  const q = useQuery({ queryKey: ["reports"], queryFn: getReports });
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-[1200px]" />;
  if (q.isError) return <p role="alert" className="text-alert">{t("impact.nothing")}</p>;
  const { solar_reports, cards } = q.data;
  const date = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium" });

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader title={t("title")} />

      <section aria-labelledby="impact-card" className="flex flex-col gap-4 rounded-panel border border-concrete bg-parapet p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 id="impact-card" className="type-heading text-xl">
            {t("impactCardTitle")}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-cell-muted">{t("impactCardBody")}</p>
        </div>
        <Button asChild>
          <Link href="/app/reports/impact">
            <FileText aria-hidden strokeWidth={1.75} />
            {t("openImpact")}
          </Link>
        </Button>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="cards" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
          <h2 id="cards" className="type-heading text-xl">
            {t("cardsTitle")}
          </h2>
          <p className="mt-1 text-sm text-cell-muted">{t("cardsBody")}</p>
          {cards.length === 0 ? (
            <p className="mt-4 text-sm">{t("cardsEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-concrete border-y border-concrete">
              {cards.map((c) => (
                <li key={c.bill_id} className="flex items-center gap-4 py-3">
                  <span className={cn("w-8 type-display text-3xl", GRADE_TONE[c.grade])} aria-hidden>
                    {c.grade}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="sr-only">{c.grade}. </span>
                      {t("billEnding", { date: date(c.period_end) })}
                    </p>
                    <p className="type-small text-cell-muted">{t("change", { pct: `${c.change_pct > 0 ? "+" : ""}${formatNumber(c.change_pct, lang, 1)}` })}</p>
                  </div>
                  <HowCalculated steps={[c.working]} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="solar-reports" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
          <h2 id="solar-reports" className="type-heading text-xl">
            {t("solarTitle")}
          </h2>
          {solar_reports.length === 0 ? (
            <EmptyState
              className="mt-4"
              title={t("solarEmpty")}
              action={
                <Button asChild variant="secondary">
                  <Link href="/app/solar/new">{t("solarNew")}</Link>
                </Button>
              }
            />
          ) : (
            <ul className="mt-4 divide-y divide-concrete border-y border-concrete">
              {solar_reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/solar/${r.id}`} className="block py-3 hover:bg-limewash/60">
                    <p className="text-sm">{date(r.created_at)}</p>
                    <p className="type-small text-cell-muted">
                      {r.feasible ? t("solarRow", { kw: formatNumber(r.size_kw, lang, 1), inr: formatInr(r.savings_year1_inr, lang) }) : t("notFeasible")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function LedgerTable({ impact }: { impact: ImpactReport }) {
  const t = useTranslations("reportsPage.impact");
  const lang = useLocale();
  const { estimated, measured } = impact.ledger;
  const rows = METRICS.filter((m) => estimated[m] || measured[m]);
  if (rows.length === 0) return <p className="mt-3 text-sm text-cell-muted">{t("nothing")}</p>;
  return (
    <table className="mt-4 w-full text-sm">
      <thead>
        <tr className="border-b border-cell text-left type-small text-cell-muted">
          <th scope="col" className="py-2 font-normal">{t("metric")}</th>
          <th scope="col" className="py-2 text-right font-normal">{t("measured")}</th>
          <th scope="col" className="py-2 text-right font-normal">{t("estimated")}</th>
          <th scope="col" className="py-2 text-right font-normal">{t("total")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m} className="border-b border-concrete">
            <th scope="row" className="py-2.5 text-left font-normal">{t(`metrics.${m}`)}</th>
            <td className="py-2.5 text-right type-number">{measured[m] ? fmtMetric(m, measured[m]!, lang) : "—"}</td>
            <td className="py-2.5 text-right type-number">{estimated[m] ? fmtMetric(m, estimated[m]!, lang) : "—"}</td>
            <td className="py-2.5 text-right type-number font-medium">{fmtMetric(m, (measured[m] ?? 0) + (estimated[m] ?? 0), lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ImpactReportPage() {
  const t = useTranslations("reportsPage.impact");
  const lang = useLocale();
  const format = useFormatter();
  const q = useQuery({ queryKey: ["reports"], queryFn: getReports });
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-[900px]" />;
  if (q.isError) return <p role="alert" className="text-alert">{t("nothing")}</p>;
  const r = q.data.impact;
  const a = r.activity;
  const date = (s: string) => format.dateTime(new Date(s), { dateStyle: "long" });
  const projected = METRICS.filter((m) => r.ledger.projected[m]);

  return (
    <article className="mx-auto max-w-[900px] space-y-10 print:max-w-none print:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/app/reports" className="inline-flex items-center gap-1.5 type-small text-cell-muted hover:text-cell">
          <ArrowLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
          {t("back")}
        </Link>
        <div className="flex items-center gap-3">
          <p className="hidden type-small text-cell-muted sm:block">{t("printHint")}</p>
          <Button onClick={() => window.print()}>
            <Printer aria-hidden strokeWidth={1.75} />
            {t("download")}
          </Button>
        </div>
      </div>

      <header className="border-b-2 border-cell pb-6">
        <p className="type-ui text-sm tracking-wide">groundwork</p>
        <h1 className="mt-2 type-display text-4xl sm:text-5xl">{t("title")}</h1>
        <p className="mt-3 text-cell-muted">
          {r.name ? (r.city ? t("forCity", { name: r.name, city: r.city }) : t("for", { name: r.name })) : null}
        </p>
        <p className="type-small text-cell-muted">
          {r.since ? t("period", { since: date(r.since), today: date(r.generated_at) }) : t("periodEmpty", { today: date(r.generated_at) })}
        </p>
      </header>

      <section aria-labelledby="realised">
        <h2 id="realised" className="type-heading text-2xl">
          {t("realisedTitle")}
        </h2>
        <p className="mt-1 max-w-[65ch] text-sm text-cell-muted">{t("realisedBody")}</p>
        <LedgerTable impact={r} />
      </section>

      {projected.length > 0 && (
        <section aria-labelledby="projected">
          <h2 id="projected" className="type-heading text-2xl">
            {t("projectedTitle")}
          </h2>
          <p className="mt-1 max-w-[65ch] text-sm text-cell-muted">{t("projectedBody")}</p>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {projected.map((m) => (
              <div key={m} className="border-t border-concrete pt-2">
                <dt className="type-small text-cell-muted">{t(`metrics.${m}`)}</dt>
                <dd className="type-number text-xl">{fmtMetric(m, r.ledger.projected[m]!, lang)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 type-small text-cell-muted">{t("projected")}</p>
        </section>
      )}

      <section aria-labelledby="activity">
        <h2 id="activity" className="type-heading text-2xl">
          {t("activityTitle")}
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          <li>{t("activity.bills", { count: a.bills })}</li>
          <li>{t("activity.solarReports", { count: a.solar_reports })}</li>
          {a.installed && <li>{t("activity.installed", { kw: formatNumber(a.installed.size_kw, lang, 1), date: date(a.installed.installed_on) })}</li>}
          <li>{t("activity.leaks", { found: a.leaks_found, fixed: a.leaks_fixed })}</li>
          <li>
            {t("activity.waste", {
              count: a.waste_scans,
              kg: formatNumber(a.waste_kg, lang, 1),
              diverted: formatNumber(a.waste_kg_diverted, lang, 1),
            })}
          </li>
        </ul>
      </section>

      {r.working.length > 0 && (
        <section aria-labelledby="working">
          <h2 id="working" className="type-heading text-2xl">
            {t("workingTitle")}
          </h2>
          <WorkingSteps steps={r.working} className="mt-4" />
        </section>
      )}

      <section aria-labelledby="method">
        <h2 id="method" className="type-heading text-2xl">
          {t("methodTitle")}
        </h2>
        <p className="mt-2 max-w-[65ch] text-sm">{t("method")}</p>
        <Link href="/methodology" className="mt-1 inline-block text-sm underline underline-offset-4 print:hidden">
          {t("methodLink")}
        </Link>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources" className="type-heading text-2xl">
          {t("sourcesTitle")}
        </h2>
        <ol className="mt-3 space-y-3 text-sm">
          {r.sources.map((s, i) => (
            <li key={s.label} className="grid grid-cols-[2rem_1fr] gap-x-2">
              <span className="type-number text-cell-muted">{i + 1}.</span>
              <div>
                <p className="type-ui">
                  {s.label}
                  <span className="ml-2 rounded-[4px] border border-concrete px-1.5 type-small font-normal text-cell-muted">
                    {t(`status.${s.status as "verified"}`)}
                  </span>
                </p>
                <p className="text-cell-muted">
                  {s.source}
                  {s.as_of && ` (${t("asOf", { date: date(s.as_of) })})`}
                </p>
                {s.url && <p className="break-all type-small text-cell-muted">{s.url}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
