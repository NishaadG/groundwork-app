"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Printer, Share2, Sparkles } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PANELS_PER_KW, Terrace } from "@/components/brand/terrace";
import { ChartFrame, LegendItem } from "@/components/charts/chart-frame";
import { MonthlyChart, PaybackChart } from "@/components/charts/solar-charts";
import { HowCalculated } from "@/components/features/working/how-calculated";
import type { WorkingStep } from "@/components/features/working/working-steps";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Readout } from "@/components/ui/readout";
import { Slider } from "@/components/ui/slider";
import { getTips, type StoredReport } from "@/lib/api";
import constants from "@/lib/calc/data/constants.json";
import { calcSolar, type Shading } from "@/lib/calc/solar";
import { billBreakdown } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const PORTAL = "https://pmsuryaghar.gov.in/";
const SQFT_PER_KW = constants.constants.roof_area_per_kw.value * 10.7639;

/** Which calc steps explain which number. */
const STEPS: Record<string, string[]> = {
  size: ["consumption", "irradiance", "specific_yield", "size"],
  subsidy: ["subsidy"],
  youPay: ["cost", "subsidy", "net_cost"],
  payback: ["savings_year1", "net_cost", "payback"],
  yearOne: ["consumption", "savings_year1"],
  lifetime: ["savings_year1", "savings_25y"],
  generation: ["irradiance", "specific_yield", "generation"],
  co2: ["generation", "co2"],
};

function pick(working: WorkingStep[], key: string) {
  const ids = STEPS[key] ?? [];
  return working.filter((w) => ids.includes(w.id));
}

export function ReportView({
  data,
  onShare,
  onSaveScenario,
  shared = false,
}: {
  data: StoredReport;
  onShare?: () => Promise<void>;
  onSaveScenario?: (scenario: { size_kw: number; cost_inr: number | null; tariff_escalation: number }) => Promise<void>;
  shared?: boolean;
}) {
  const t = useTranslations("solar.report");
  const lang = useLocale();
  const format = useFormatter();
  const inr = (n: number) => formatInr(n, lang);
  const { inputs } = data;
  const stored = data.report;

  const defaultEsc = inputs.scenario.tariff_escalation ?? constants.constants.tariff_escalation_default.value;
  const maxKw = Math.max(
    1,
    Math.floor(Math.min(stored.candidates.by_roof_kw, stored.candidates.by_load_kw ?? Infinity, 10) * 2) / 2,
  );
  const [size, setSize] = useState(stored.size_kw);
  const [esc, setEsc] = useState(defaultEsc);
  const [quote, setQuote] = useState(inputs.scenario.cost_inr ? String(inputs.scenario.cost_inr) : "");
  const [saving, setSaving] = useState(false);
  const quoteN = quote.trim() === "" ? null : Number(quote);
  const quoteValid = quoteN === null || (Number.isFinite(quoteN) && quoteN > 0);

  const modified =
    size !== stored.size_kw ||
    Math.abs(esc - defaultEsc) > 1e-9 ||
    (quoteValid && quoteN !== (inputs.scenario.cost_inr ?? null));

  const r = useMemo(
    () =>
      calcSolar({
        irradiance_kwh_m2_day: inputs.irradiance_kwh_m2_day,
        monthly_units: inputs.monthly_units,
        roof_area_sqft: inputs.roof.roof_area_sqft,
        shading: inputs.roof.shading as Shading,
        sanctioned_load_kw: stored.candidates.by_load_kw,
        tariff: inputs.tariff,
        bill: inputs.bill_context,
        tariff_escalation: esc,
        cost_override_inr: quoteValid ? quoteN : null,
        size_override_kw: stored.feasible ? size : null,
      }),
    [inputs, stored, esc, quoteN, quoteValid, size],
  );

  const yearsCumulative = useMemo(() => {
    const out: number[] = [];
    let cum = 0;
    for (let n = 1; n <= 25; n++) {
      cum += r.savings_year1_inr * (1 + esc) ** (n - 1) * (1 - constants.constants.panel_degradation.value) ** (n - 1);
      out.push(cum);
    }
    return out;
  }, [r.savings_year1_inr, esc]);

  const avgUnits = inputs.monthly_units.reduce((a, b) => a + b, 0) / 12;
  const breakdown = billBreakdown(avgUnits, inputs.tariff, inputs.bill_context);
  const working = data.working;
  const drawer = (key: string) =>
    !modified && <HowCalculated steps={pick(working, key)} title={t(key === "size" ? "size" : (key as "subsidy"))} />;

  if (!stored.feasible) {
    return (
      <section className="rounded-panel border border-concrete bg-parapet p-6">
        <h2 className="type-heading text-2xl">{t("notFeasibleTitle")}</h2>
        <p className="mt-2 max-w-[60ch] text-cell-muted">
          {t("notFeasibleBody", { sqft: formatNumber(Math.ceil(SQFT_PER_KW), lang) })}
        </p>
        <div className="mt-4">
          <HowCalculated steps={pick(working, "size")} />
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-10">
      {/* Headline */}
      <section className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="type-small text-cell-muted">{t("size")}</p>
          <p className="mt-1 type-number text-6xl leading-none">
            {formatNumber(r.size_kw, lang, 1)}
            <span className="ml-2 text-2xl text-cell-muted">kW</span>
          </p>
          <p className="mt-3 max-w-[40ch] text-cell-muted">{t(`limitedBy.${stored.candidates.limited_by}`)}</p>
          <div className="mt-2">{drawer("size")}</div>
          <div className="mt-6 rounded-panel border border-concrete bg-limewash/60 p-3">
            <Terrace
              panels={Math.round(r.size_kw * PANELS_PER_KW)}
              title={t("sizeValue", { kw: formatNumber(r.size_kw, lang, 1) })}
              className="h-auto w-full"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 content-start gap-px overflow-hidden rounded-panel border border-concrete bg-concrete lg:col-span-7">
          {[
            { key: "subsidy", value: inr(r.subsidy_inr) },
            { key: "youPay", value: inr(r.net_cost_inr) },
            {
              key: "payback",
              value:
                r.payback_years === null ? (
                  t("noPayback")
                ) : (
                  <>
                    {formatNumber(r.payback_years, lang, 1)}
                    <span className="ml-1.5 type-small font-normal text-cell-muted">{t("years")}</span>
                  </>
                ),
            },
            { key: "yearOne", value: inr(r.savings_year1_inr), tone: "leaf" as const },
            { key: "lifetime", value: inr(r.savings_25y_net_inr), tone: "leaf" as const },
            {
              key: "generation",
              value: (
                <>
                  {formatNumber(r.annual_generation_kwh, lang)}
                  <span className="ml-1.5 type-small font-normal text-cell-muted">{t("kwhYear")}</span>
                </>
              ),
            },
            {
              key: "co2",
              value: (
                <>
                  {formatNumber(r.co2_avoided_t_per_year, lang, 2)}
                  <span className="ml-1.5 type-small font-normal text-cell-muted">{t("tonnes")}</span>
                </>
              ),
            },
          ].map((item) => (
            <div key={item.key} className="bg-parapet p-3 last:col-span-2 sm:p-5">
              <Readout label={t(item.key as "subsidy")} value={item.value} tone={item.tone ?? "ink"} />
              <div className="mt-2 min-h-5">{drawer(item.key)}</div>
            </div>
          ))}
        </div>
      </section>

      {modified && !shared && onSaveScenario && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-cell/30 bg-parapet px-4 py-3 print:hidden">
          <p className="text-sm">{t("scenarioIntro")}</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={saving || !quoteValid}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSaveScenario({ size_kw: size, cost_inr: quoteN, tariff_escalation: esc });
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t("saveScenario")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSize(stored.size_kw);
                setEsc(defaultEsc);
                setQuote(inputs.scenario.cost_inr ? String(inputs.scenario.cost_inr) : "");
              }}
            >
              {t("reset")}
            </Button>
          </div>
        </div>
      )}

      {/* Scenario sliders */}
      {!shared && (
        <section aria-labelledby="scenario" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6 print:hidden">
          <h2 id="scenario" className="type-heading text-xl">
            {t("scenarioTitle")}
          </h2>
          <div className="mt-6 grid gap-8 md:grid-cols-3">
            <div>
              <p id="sc-size" className="type-ui text-sm">
                {t("scenarioSize")}
              </p>
              <p className="mt-1 type-number text-2xl">{formatNumber(size, lang, 1)} kW</p>
              <Slider
                min={1}
                max={maxKw}
                step={0.5}
                value={[size]}
                onValueChange={([v]) => v !== undefined && setSize(v)}
                thumbLabel={t("scenarioSize")}
                valueText={(v) => `${formatNumber(v, lang, 1)} kW`}
                aria-labelledby="sc-size"
                disabled={maxKw <= 1}
              />
            </div>
            <div>
              <p id="sc-esc" className="type-ui text-sm">
                {t("scenarioEsc")}
              </p>
              <p className="mt-1 type-number text-2xl">{formatNumber(esc * 100, lang, 1)}%</p>
              <Slider
                min={0}
                max={0.08}
                step={0.005}
                value={[esc]}
                onValueChange={([v]) => v !== undefined && setEsc(v)}
                thumbLabel={t("scenarioEsc")}
                valueText={(v) => `${formatNumber(v * 100, lang, 1)}%`}
                aria-labelledby="sc-esc"
              />
            </div>
            <Field id="sc-quote" label={t("scenarioCost")} hint={t("scenarioCostHint")} error={quoteValid ? undefined : t("scenarioCostHint")}>
              <Input inputMode="numeric" value={quote} onChange={(e) => setQuote(e.target.value)} />
            </Field>
          </div>
        </section>
      )}

      {/* Charts */}
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartFrame
          title={t("monthlyTitle")}
          source={t("monthlySource")}
          tableLabel={t("table")}
          chartLabel={t("chart")}
          legend={
            <div className="flex gap-4">
              <LegendItem color="var(--chart-use)" label={t("use")} />
              <LegendItem color="var(--chart-gen)" label={t("gen")} />
            </div>
          }
          table={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-concrete text-left type-small text-cell-muted">
                  <th scope="col" className="py-2 font-normal">{t("month")}</th>
                  <th scope="col" className="py-2 text-right font-normal">{t("use")} ({t("kwh")})</th>
                  <th scope="col" className="py-2 text-right font-normal">{t("gen")} ({t("kwh")})</th>
                </tr>
              </thead>
              <tbody>
                {inputs.monthly_units.map((u, i) => (
                  <tr key={i} className="border-b border-dashed border-concrete">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {format.dateTime(new Date(2026, i, 1), { month: "long" })}
                    </th>
                    <td className="py-1.5 text-right type-number">{formatNumber(Math.round(u), lang)}</td>
                    <td className="py-1.5 text-right type-number">{formatNumber(Math.round(r.generation_kwh[i]!), lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <MonthlyChart
            use={inputs.monthly_units}
            gen={r.generation_kwh}
            useLabel={t("use")}
            genLabel={t("gen")}
            unit={t("kwh")}
            title={t("monthlyTitle")}
          />
        </ChartFrame>

        <ChartFrame
          title={t("paybackTitle")}
          source={t("paybackSource")}
          tableLabel={t("table")}
          chartLabel={t("chart")}
          table={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-concrete text-left type-small text-cell-muted">
                  <th scope="col" className="py-2 font-normal">{t("year")}</th>
                  <th scope="col" className="py-2 text-right font-normal">{t("cumulative")}</th>
                </tr>
              </thead>
              <tbody>
                {yearsCumulative.map((c, i) => (
                  <tr key={i} className={cn("border-b border-dashed border-concrete", c >= r.net_cost_inr && (yearsCumulative[i - 1] ?? 0) < r.net_cost_inr && "font-semibold")}>
                    <th scope="row" className="py-1.5 text-left font-normal">{i + 1}</th>
                    <td className="py-1.5 text-right type-number">{inr(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <PaybackChart
            cumulative={yearsCumulative}
            netCost={r.net_cost_inr}
            paybackYears={r.payback_years}
            title={t("paybackTitle")}
            cumulativeLabel={t("cumulative")}
            netCostLabel={t("netCost")}
            yearLabel={t("year")}
          />
        </ChartFrame>
      </div>

      {/* Cost and the bill */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="cost" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
          <h2 id="cost" className="type-heading text-xl">{t("costTitle")}</h2>
          <dl className="mt-4 divide-y divide-concrete border-y border-concrete">
            <div className="flex justify-between gap-4 py-3">
              <dt>{quoteValid && quoteN ? t("quote") : t("benchmark")}</dt>
              <dd className="type-number">{inr(r.cost_inr)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3">
              <dt>{t("subsidy")}</dt>
              <dd className="type-number text-leaf">− {inr(r.subsidy_inr)}</dd>
            </div>
            <div className="flex justify-between gap-4 py-3 font-semibold">
              <dt>{t("youPay")}</dt>
              <dd className="type-number">{inr(r.net_cost_inr)}</dd>
            </div>
          </dl>
          <p className="mt-3 type-small text-cell-muted">{t("costNote")}</p>
        </section>

        <section aria-labelledby="bill" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
          <h2 id="bill" className="type-heading text-xl">{t("billTitle")}</h2>
          <p className="mt-2 text-sm text-cell-muted">{t("billIntro")}</p>
          <p className="mt-3 type-small text-cell-muted">
            {t("billMonth", { units: formatNumber(Math.round(avgUnits), lang) })}
          </p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {breakdown.slabs.map((s) => (
                <tr key={s.from_units} className="border-b border-dashed border-concrete">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {s.to_units === null
                      ? s.from_units === 0
                        ? t("billAll")
                        : t("billSlabTop", { from: formatNumber(s.from_units, lang) })
                      : t("billSlab", { from: formatNumber(s.from_units + 1, lang), to: formatNumber(s.to_units, lang) })}
                    <span className="ml-2 type-small text-cell-muted">
                      {formatNumber(s.units, lang)} × ₹{formatNumber(s.rate, lang, 2)}
                    </span>
                  </th>
                  <td className="py-1.5 text-right type-number">{inr(s.amount)}</td>
                </tr>
              ))}
              {Object.entries(breakdown.charges)
                .filter(([k, v]) => k !== "energy" && v > 0)
                .map(([k, v]) => (
                  <tr key={k} className="border-b border-dashed border-concrete">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {chargeLabel(k, inputs.tariff, t)}
                    </th>
                    <td className="py-1.5 text-right type-number">{inr(v)}</td>
                  </tr>
                ))}
              <tr className="font-semibold">
                <th scope="row" className="py-2 text-left">{t("recalc")}</th>
                <td className="py-2 text-right type-number">{inr(breakdown.total)}</td>
              </tr>
            </tbody>
          </table>
          {data.bill_check && (
            <p className={cn("mt-3 text-sm", data.bill_check.matches ? "text-cell-muted" : "text-alert")}>
              {t("printed")}: {inr(data.bill_check.billed_total)}.{" "}
              {data.bill_check.matches
                ? t("billMatches", { pct: formatNumber(Math.max(1, Math.ceil(Math.abs(data.bill_check.diff_pct))), lang) })
                : t("billDiffers", { pct: formatNumber(Math.abs(data.bill_check.diff_pct), lang, 1) })}
            </p>
          )}
        </section>
      </div>

      {!shared && <TipsSection reportId={data.id} initial={data.tips} />}

      {/* Notes and next steps */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="notes" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
          <h2 id="notes" className="type-heading text-xl">{t("notesTitle")}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-cell-muted">
            <li>{t("basis", { discom: inputs.tariff.discom, category: inputs.tariff.category, fy: inputs.tariff.fy })}</li>
            {(inputs.months_from_data ?? 0) < 12 && <li>{t("seasonNote", { months: inputs.months_from_data ?? 0 })}</li>}
            <li>{inputs.tariff.net_metering.note}</li>
            {(inputs.tariff.notes ?? []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
        {!shared && (
          <section aria-labelledby="next" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
            <h2 id="next" className="type-heading text-xl">{t("nextTitle")}</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
              <li>{t("next1")}</li>
              <li>{t("next2")}</li>
              <li>{t("next3")}</li>
            </ol>
            <Button asChild variant="secondary" className="mt-5">
              <a href={PORTAL} target="_blank" rel="noopener noreferrer">
                {t("portal")}
                <ExternalLink aria-hidden strokeWidth={1.75} />
              </a>
            </Button>
          </section>
        )}
      </div>

      {!shared && (
        <div className="flex flex-wrap gap-3 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer aria-hidden strokeWidth={1.75} />
            {t("print")}
          </Button>
          {onShare && (
            <Button variant="secondary" onClick={() => void onShare().catch(() => toast.error(t("shareFailed")))}>
              <Share2 aria-hidden strokeWidth={1.75} />
              {t("share")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function chargeLabel(key: string, tariff: StoredReport["inputs"]["tariff"], t: (k: "fixed" | "wheeling" | "adders") => string) {
  if (key === "fixed" || key === "wheeling" || key === "adders") return t(key);
  const pc = tariff.percent_charges?.find((p) => p.id === key);
  if (pc) return `${pc.label} (${pc.pct}%)`;
  return tariff.bill_inputs?.find((b) => b.id === key)?.label ?? key;
}

/** AI-written tips (no numbers allowed) beside one figure computed in code. */
function TipsSection({ reportId, initial }: { reportId: string; initial: StoredReport["tips"] }) {
  const t = useTranslations("solar.report");
  const lang = useLocale();
  const q = useQuery({
    queryKey: ["tips", reportId],
    queryFn: () => getTips(reportId),
    initialData: initial,
    retry: false,
    staleTime: Infinity,
  });
  if (!q.data) return null;
  return (
    <section aria-labelledby="tips" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tips" className="type-heading text-xl">
          {t("tipsTitle")}
        </h2>
        <p className="inline-flex items-center gap-1 type-small text-cell-muted">
          <Sparkles aria-hidden className="size-3.5" strokeWidth={1.75} />
          {t("tipsByAi")}
        </p>
      </div>
      <p className="mt-2 text-sm text-cell-muted">
        {t("tipsRate", { rate: formatNumber(q.data.rupees_per_unit_cut, lang, 2) })}
      </p>
      <ul className="mt-4 grid gap-4 md:grid-cols-3">
        {q.data.tips.map((tip) => (
          <li key={tip.title} className="border-t-2 border-sun pt-3">
            <h3 className="type-heading text-base">{tip.title}</h3>
            <p className="mt-1 text-sm text-cell-muted">{tip.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
