"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { PANELS_PER_KW, Terrace } from "@/components/brand/terrace";
import { Button } from "@/components/ui/button";
import { CountUp, Readout } from "@/components/ui/readout";
import { Slider } from "@/components/ui/slider";
import sample from "@/lib/calc/data/sample_household.json";
import { calcSolar, type Shading } from "@/lib/calc/solar";
import { loadTariff } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";
import { Link } from "@/i18n/navigation";

const tariff = loadTariff(sample.inputs.tariff);
const BASE = {
  irradiance_kwh_m2_day: sample.inputs.irradiance_kwh_m2_day,
  monthly_units: sample.inputs.monthly_units,
  roof_area_sqft: sample.inputs.roof_area_sqft,
  shading: sample.inputs.shading as Shading,
  sanctioned_load_kw: sample.inputs.sanctioned_load_kw,
  tariff,
};
const RECOMMENDED = sample.report.recommended_kw;
// The slider stops at what the roof fits and the sanctioned load allows.
const MAX_KW = Math.floor(
  Math.min(sample.report.candidates.by_roof_kw, sample.inputs.sanctioned_load_kw) * 2,
) / 2;

export function Hero() {
  const t = useTranslations("hero");
  const lang = useLocale();
  const [size, setSize] = useState(RECOMMENDED);
  const [touched, setTouched] = useState(false);
  const r = useMemo(() => calcSolar({ ...BASE, size_override_kw: size }), [size]);
  const intro = !touched;

  const inr = (n: number) => formatInr(n, lang);
  const kw = formatNumber(size, lang, 1);

  return (
    <section className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-12 pb-24 sm:px-6 md:pt-20 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5 lg:pt-6">
        <h1 className="type-display text-[2.625rem] sm:text-5xl lg:text-[4.125rem]">{t("title")}</h1>
        <p className="mt-6 max-w-[34ch] text-lg text-cell-muted">{t("subtitle")}</p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Button asChild size="lg">
            <Link href="/signup">{t("cta")}</Link>
          </Button>
          <Button asChild variant="link">
            <Link href="/how-it-works">{t("secondary")}</Link>
          </Button>
        </div>
        <p className="mt-4 type-small text-cell-muted">{t("ctaNote")}</p>
      </div>

      <div className="lg:col-span-7">
        <div className="rounded-panel border border-concrete bg-parapet">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-concrete px-5 py-4 sm:px-6">
            <h2 className="type-heading text-base">{t("sampleTitle")}</h2>
            <p className="type-small text-cell-muted">
              {t("sampleDetail", {
                units: formatNumber(sample.inputs.monthly_units[0]!, lang),
                roof: formatNumber(sample.inputs.roof_area_sqft, lang),
              })}
            </p>
          </div>

          <div className="bg-limewash/60 px-3 pt-3 sm:px-6 sm:pt-6">
            <Terrace
              panels={Math.round(size * PANELS_PER_KW)}
              intro={intro}
              title={t("terraceTitle", { count: Math.round(size * PANELS_PER_KW) })}
              className="mx-auto block h-auto w-full max-w-[560px]"
            />
          </div>

          <div className="border-t border-concrete px-5 pt-5 pb-6 sm:px-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="type-small text-cell-muted" id="size-label">
                  {t("sizeLabel")}
                </p>
                <p className="mt-1 type-number text-4xl leading-none whitespace-nowrap" aria-live="polite">
                  {kw}
                  <span className="ml-1.5 text-xl text-cell-muted">kW</span>
                </p>
              </div>
              {size === RECOMMENDED && (
                <p className="pb-1 text-right type-small text-cell-muted">{t("recommended")}</p>
              )}
            </div>
            <Slider
              className="mt-3"
              min={1}
              max={MAX_KW}
              step={0.5}
              value={[size]}
              onValueChange={([v]) => {
                setTouched(true);
                if (v !== undefined) setSize(v);
              }}
              thumbLabel={t("sizeLabel")}
              valueText={(v) => t("sizeValueText", { kw: formatNumber(v, lang, 1) })}
              aria-labelledby="size-label"
            />

            <div className="mt-6 grid grid-cols-2 border-t border-concrete [&>div]:border-b [&>div]:border-concrete [&>div]:py-5 [&>div:nth-child(odd)]:border-r [&>div:nth-child(odd)]:pr-4 [&>div:nth-child(even)]:pl-4 sm:[&>div:nth-child(odd)]:pr-6 sm:[&>div:nth-child(even)]:pl-6">
              <Readout
                label={t("subsidy")}
                value={<CountUp value={r.subsidy_inr} format={inr} play={intro} delay={1.1} />}
              />
              <Readout
                label={t("youPay")}
                value={<CountUp value={r.net_cost_inr} format={inr} play={intro} delay={1.1} />}
              />
              <Readout
                label={t("payback")}
                value={
                  r.payback_years === null ? (
                    t("paybackNever")
                  ) : (
                    <>
                      <CountUp
                        value={r.payback_years}
                        format={(n) => formatNumber(n, lang, 1)}
                        play={intro}
                        delay={1.1}
                      />
                      <span className="ml-1.5 type-small font-normal text-cell-muted">
                        {t("paybackUnit")}
                      </span>
                    </>
                  )
                }
              />
              <Readout
                label={t("yearOne")}
                tone="leaf"
                value={<CountUp value={r.savings_year1_inr} format={inr} play={intro} delay={1.1} />}
              />
            </div>
            <p className="mt-6 type-small text-cell-muted">
              {t("basis")}{" "}
              <a href="#working" className="text-cell underline underline-offset-4 hover:no-underline">
                {t("seeWorking")}
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
