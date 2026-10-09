import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Renders a calc `working` trace. The same component powers the
 * "How we calculated this" drawer in the app and the landing page teaser, so the
 * explanation is always the maths itself.
 */
export interface WorkingStep {
  id: string;
  label: string;
  formula: string;
  inputs: Record<string, number | string | null | number[]>;
  result: number | string | null | number[];
  unit: string;
  source: { name: string; url: string | null; as_of: string | null; status: string | null } | null;
}

function useFormatValue() {
  const lang = useLocale();
  const t = useTranslations("working");
  return (key: string, value: WorkingStep["result"], unit = ""): string => {
    if (value === null) return t("noValue");
    if (Array.isArray(value)) return value.map((v) => formatNumber(v, lang, 2)).join(" · ");
    if (typeof value === "string") {
      if (key === "limited_by" && (value === "need" || value === "roof" || value === "load")) {
        return t(`limitedBy.${value}`);
      }
      if (key === "shading" && (value === "none" || value === "partial" || value === "heavy")) {
        return t(`shading.${value}`);
      }
      return value;
    }
    if (unit === "₹" || key.endsWith("_inr")) return formatInr(value, lang);
    if (key.endsWith("_per_year") || key === "performance_ratio" || key === "shading_factor") {
      return key.endsWith("_per_year") ? `${formatNumber(value * 100, lang, 1)}%` : formatNumber(value, lang, 2);
    }
    const decimals = Number.isInteger(value) ? 0 : value < 10 ? 2 : 1;
    return formatNumber(value, lang, decimals);
  };
}

function MonthGrid({ values, unit }: { values: number[]; unit: string }) {
  const lang = useLocale();
  const month = new Intl.DateTimeFormat(lang === "en" ? "en-IN" : lang, { month: "short" });
  return (
    <div className="mt-3">
      <dl className="grid grid-cols-6 gap-x-2 gap-y-2">
        {values.map((v, i) => (
          <div key={i}>
            <dt className="type-small text-cell-muted">{month.format(new Date(2026, i, 1))}</dt>
            <dd className="type-number text-base">{formatNumber(v, lang, 2)}</dd>
          </div>
        ))}
      </dl>
      {unit && <p className="mt-2 type-small text-cell-muted">{unit}</p>}
    </div>
  );
}

export function WorkingSteps({ steps, className }: { steps: WorkingStep[]; className?: string }) {
  const t = useTranslations("working");
  const tc = useTranslations("common");
  const fmt = useFormatValue();
  const lang = useLocale();
  const inputLabel = (key: string) =>
    t.has(`inputLabels.${key}`) ? t(`inputLabels.${key}`) : key.replaceAll("_", " ");
  // English shows the calculation code's own words. Other languages use the translated
  // title and formula for the step's id, filling in the one number some of them carry.
  const words = (step: WorkingStep) => {
    if (lang === "en") return { label: step.label, formula: step.formula };
    const k = `steps.${step.id}`;
    const years = step.label.match(/\d+/)?.[0] ?? "";
    const days = step.formula.match(/next (\d+) days/)?.[1];
    const label = t.has(`${k}.label`) ? t(`${k}.label`, { years }) : step.label;
    let formula = step.formula;
    if (step.id === "cost") formula = t(`${k}.${step.formula === "your quote" ? "formulaQuote" : "formulaBenchmark"}`);
    else if (step.id === "tank_forecast") formula = days ? t(`${k}.formula`, { days }) : step.formula;
    else if (t.has(`${k}.formula`)) formula = t(`${k}.formula`, { years });
    return { label, formula };
  };

  return (
    <ol className={cn("divide-y divide-concrete border-y border-concrete", className)}>
      {steps.map((step, i) => (
        <li key={step.id} className="grid gap-4 py-6 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-4">
            <p className="type-small text-cell-muted">{t("step", { n: i + 1 })}</p>
            <h3 className="mt-1 type-heading text-lg">{words(step).label}</h3>
            {Array.isArray(step.result) ? (
              <MonthGrid values={step.result} unit={step.unit} />
            ) : (
              <p className="mt-3 type-number text-2xl leading-none">
                {fmt(step.id, step.result, step.unit)}
                {step.unit && step.unit !== "₹" && step.result !== null && (
                  <span className="ml-1.5 type-small font-normal text-cell-muted">{step.unit}</span>
                )}
              </p>
            )}
          </div>
          <div className="md:col-span-8">
            <p className="type-small text-cell-muted">{t("formula")}</p>
            <p className="mt-1 max-w-[68ch] first-letter:uppercase">{words(step).formula}</p>
            {Object.keys(step.inputs).length > 0 && (
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                {Object.entries(step.inputs).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-4 border-b border-dashed border-concrete pb-1.5">
                    <dt className="text-sm text-cell-muted">{inputLabel(key)}</dt>
                    <dd className="type-number text-base">{fmt(key, value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {step.source && (
              <p className="mt-4 type-small text-cell-muted">
                <span className="text-cell">{tc("source")}:</span> {step.source.name}
                {step.source.status && step.source.status !== "verified" && (
                  <> ({tc(`status.${step.source.status as "estimate" | "assumption"}`)})</>
                )}
                {step.source.url && (
                  <>
                    {" "}
                    <a
                      href={step.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-cell underline underline-offset-4 hover:no-underline"
                    >
                      {new URL(step.source.url).hostname.replace(/^www\./, "")}
                      <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
