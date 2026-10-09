"use client";

import { useQuery } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Terrace } from "@/components/brand/terrace";
import { BillsChart } from "@/components/charts/bills-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { PageHeader } from "@/components/features/app/app-shell";
import { reportCardImage, shareOrDownload } from "@/components/features/app/report-card-image";
import { useProfile } from "@/components/features/app/use-profile";
import { HowCalculated } from "@/components/features/working/how-calculated";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { getHome, type HomeSummary } from "@/lib/api";
import { TARIFFS } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Metric = "inr" | "kwh" | "litres" | "kg" | "co2_t";

function realised(l: HomeSummary["ledger"], m: Metric) {
  return (l.estimated[m] ?? 0) + (l.measured[m] ?? 0);
}

function LedgerStrip({ ledger, working }: { ledger: HomeSummary["ledger"]; working: HomeSummary["ledger_working"] }) {
  const t = useTranslations("app.home");
  const lang = useLocale();
  const fmt = (m: Metric, v: number) =>
    m === "inr"
      ? formatInr(v, lang)
      : m === "kwh"
        ? `${formatNumber(v, lang)} kWh`
        : m === "litres"
          ? `${formatNumber(v, lang)} L`
          : m === "kg"
            ? `${formatNumber(v, lang, 1)} kg`
            : `${formatNumber(v, lang, 2)} t`;
  const all: { m: Metric; label: string; tone?: string }[] = [
    { m: "inr", label: t("metricInr"), tone: "text-leaf" },
    { m: "kwh", label: t("metricKwh") },
    { m: "litres", label: t("metricLitres") },
    { m: "kg", label: t("metricKg") },
    { m: "co2_t", label: t("metricCo2") },
  ];
  // Money and CO₂ always show; the resource metrics show once there's something in them
  const metrics = all.filter(({ m }) => m === "inr" || m === "co2_t" || realised(ledger, m) > 0);
  const anyRealised = metrics.some(({ m }) => realised(ledger, m) > 0);
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[metrics.length];
  const potential = ledger.projected.inr
    ? anyRealised
      ? t("ledgerPotential", { inr: formatInr(ledger.projected.inr, lang), kwh: formatNumber(ledger.projected.kwh ?? 0, lang) })
      : t("ledgerPotentialOnly", { inr: formatInr(ledger.projected.inr, lang) })
    : null;

  return (
    <section aria-labelledby="ledger" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ledger" className="type-heading text-xl">
          {t("ledgerTitle")}
        </h2>
        {anyRealised && <p className="type-small text-cell-muted">{t("ledgerRealisedNote")}</p>}
      </div>
      {anyRealised && (
        <dl className={cn("mt-4 grid grid-cols-1 gap-x-5 border-y border-concrete", cols)}>
          {metrics.map(({ m, label, tone }) => (
            <div key={m} className="border-t border-concrete py-4 first:border-t-0 sm:border-t-0">
              <dt className="type-small text-cell-muted">{label}</dt>
              <dd className={cn("mt-1 type-number text-3xl", tone)}>{fmt(m, realised(ledger, m))}</dd>
              <dd className="mt-1 type-small text-cell-muted">
                {t("ledgerThisMonth")}: {fmt(m, ledger.this_month[m] ?? 0)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {potential && <p className={cn("text-sm text-cell-muted", anyRealised ? "mt-3" : "mt-2")}>{potential}</p>}
      {anyRealised && working.length > 0 && (
        <div className="mt-3">
          <HowCalculated steps={working} title={t("ledgerTitle")} />
        </div>
      )}
    </section>
  );
}

function NextAction({ action }: { action: HomeSummary["next_action"] }) {
  const t = useTranslations("app.home.next");
  const lang = useLocale();
  const body =
    action.kind === "get_quotes"
      ? t("get_quotes", { kw: formatNumber(action.kw, lang, 1) })
      : action.kind === "bill_up"
        ? t("bill_up", { pct: formatNumber(action.pct, lang) })
        : t(action.kind);
  return (
    <section aria-labelledby="next" className="h-full rounded-panel bg-cell p-5 text-on-cell sm:p-6">
      <h2 id="next" className="type-small text-on-cell/75">
        {t("title")}
      </h2>
      <p className="mt-2 max-w-[56ch] type-heading text-xl">{body}</p>
      <Button asChild className="mt-5 bg-on-cell text-cell hover:bg-on-cell/90">
        <Link href={action.href}>{t(`${action.kind}Cta`)}</Link>
      </Button>
    </section>
  );
}

function ReportCard({ card }: { card: HomeSummary["report_card"]["energy"] }) {
  const t = useTranslations("app.home");
  const lang = useLocale();
  const change = card
    ? Math.abs(card.change_pct) < 1
      ? t("cardSame")
      : t("cardChange", {
          pct: formatNumber(Math.abs(card.change_pct), lang),
          direction: card.change_pct < 0 ? t("cardLess") : t("cardMore"),
        })
    : null;
  return (
    <section aria-labelledby="card" className="h-full rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="card" className="type-heading text-xl">
        {t("cardTitle")}
      </h2>
      {!card ? (
        <p className="mt-3 text-sm text-cell-muted">{t("cardNeedsBills")}</p>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-5">
            <span className="flex size-20 shrink-0 items-center justify-center rounded-panel border-2 border-cell type-display text-5xl">
              {card.grade}
            </span>
            <div>
              <p className="flex items-center gap-1.5 type-ui text-sm">
                <span aria-hidden className="size-2.5 rounded-[2px] bg-sun" />
                {t("cardEnergy")}
              </p>
              <p className="mt-1 text-sm text-cell-muted">{change}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <HowCalculated steps={[card.working]} title={t("cardTitle")} />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  const blob = await reportCardImage({
                    title: t("cardImageTitle"),
                    resource: t("cardEnergy"),
                    grade: card.grade,
                    change: change ?? "",
                    foot: t("cardImageFoot"),
                  });
                  await shareOrDownload(blob, `groundwork-report-card-${card.grade}.png`, t("cardImageTitle"));
                } catch (err) {
                  if (!(err instanceof DOMException && err.name === "AbortError")) toast.error(t("shareFailed"));
                }
              }}
            >
              <Share2 aria-hidden strokeWidth={1.75} />
              {t("cardShare")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Activity({ items }: { items: HomeSummary["activity"] }) {
  const t = useTranslations("app.home");
  const lang = useLocale();
  const format = useFormatter();
  return (
    <section aria-labelledby="activity">
      <h2 id="activity" className="type-heading text-xl">
        {t("activityTitle")}
      </h2>
      <ul className="mt-3 divide-y divide-concrete border-y border-concrete">
        {items.map((a) => (
          <li key={`${a.type}-${a.id}-${a.at}`} className="flex items-baseline justify-between gap-4 py-3 text-sm">
            <span>
              {a.type === "bill"
                ? t("activity.bill", { units: formatNumber(a.units_kwh, lang) })
                : a.type === "solar_report"
                  ? a.feasible
                    ? t("activity.solar_report", { kw: formatNumber(a.size_kw, lang, 1) })
                    : t("activity.solar_report_none")
                  : t("activity.solar_installed")}
            </span>
            <time dateTime={a.at} className="shrink-0 type-small text-cell-muted">
              {format.dateTime(new Date(a.at), { dateStyle: "medium" })}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AppHome() {
  const t = useTranslations("app.home");
  const to = useTranslations("onboarding");
  const ts = useTranslations("solar.report");
  const ta = useTranslations("app");
  const lang = useLocale();
  const format = useFormatter();
  const { data: p } = useProfile();
  const home = useQuery({ queryKey: ["home"], queryFn: getHome });
  if (!p) return null;

  const facts = [
    { label: to("home.city"), value: [p.city, p.state].filter(Boolean).join(", ") || null },
    { label: to("home.roof"), value: p.roof_area_sqft != null ? `${formatNumber(p.roof_area_sqft, lang)} sq ft` : null },
    { label: to("electricity.discom"), value: p.discom ? (TARIFFS[p.discom]?.discom ?? to("electricity.discomOther")) : null },
    { label: to("home.household"), value: p.household_size != null ? formatNumber(p.household_size, lang) : null },
    { label: t("waterSource"), value: p.water_source ? to(`water.sources.${p.water_source}`) : null },
  ];
  const h = home.data;
  const billPoints = (h?.bills ?? [])
    .filter((b) => b.period_end)
    .map((b) => ({
      label: format.dateTime(new Date(b.period_end!), { month: "short", year: "2-digit" }),
      value: b.units_kwh,
    }));

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader title={p.name ? t("greeting", { name: p.name }) : t("greetingNoName")} />

      {home.isPending && <Skeleton className="h-40 w-full" />}
      {home.isError && (
        <div role="alert">
          <p className="text-alert">{ta("loadError")}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void home.refetch()}>
            {ta("retry")}
          </Button>
        </div>
      )}
      {h && (
        <>
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <NextAction action={h.next_action} />
            </div>
            <div className="lg:col-span-5">
              <ReportCard card={h.report_card.energy} />
            </div>
          </div>

          {h.ledger.entries > 0 && <LedgerStrip ledger={h.ledger} working={h.ledger_working} />}

          {billPoints.length >= 2 && (
            <ChartFrame
              title={t("trendTitle")}
              source={t("trendNote")}
              tableLabel={ts("table")}
              chartLabel={ts("chart")}
              table={
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-concrete text-left type-small text-cell-muted">
                      <th scope="col" className="py-2 font-normal">{ts("month")}</th>
                      <th scope="col" className="py-2 text-right font-normal">{t("trendUnits")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billPoints.map((b, i) => (
                      <tr key={i} className="border-b border-dashed border-concrete">
                        <th scope="row" className="py-1.5 text-left font-normal">{b.label}</th>
                        <td className="py-1.5 text-right type-number">{formatNumber(b.value, lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <BillsChart points={billPoints} title={t("trendTitle")} unitLabel={t("trendUnits")} />
            </ChartFrame>
          )}

          <div className="grid gap-8 lg:grid-cols-12">
            <section aria-labelledby="your-home" className="lg:col-span-7">
              <h2 id="your-home" className="type-heading text-xl">
                {t("homeTitle")}
              </h2>
              <dl className="mt-3 divide-y divide-concrete rounded-panel border border-concrete bg-parapet">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-cell-muted">{f.label}</dt>
                    <dd className={f.value ? "text-right type-number" : "text-sm text-cell-muted"}>
                      {f.value ?? t("homeMissing")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            <div className="lg:col-span-5">
              {h.activity.length > 0 ? (
                <Activity items={h.activity} />
              ) : (
                <Terrace panels={0} title={t("homeTitle")} className="h-auto w-full" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
