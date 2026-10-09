import type { Metadata } from "next";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageIntro } from "@/components/layout/page";
import constantsData from "@/lib/calc/data/constants.json";
import pvgis from "@/lib/calc/data/eval_solar_pvgis.json";
import sample from "@/lib/calc/data/sample_household.json";
import { type Tariff, TARIFFS } from "@/lib/calc/tariff";
import { formatNumber } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodologyPage" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

type RawConstant = {
  label: string;
  value: unknown;
  unit: string;
  source: string;
  source_url: string | null;
  as_of: string;
  status: string;
};

const SOLAR_KEYS = [
  "pm_surya_ghar_subsidy",
  "solar_cost_benchmark",
  "grid_emission_factor",
  "roof_area_per_kw",
  "performance_ratio",
  "shading_factor",
  "panel_degradation",
  "tariff_escalation_default",
  "analysis_years",
];

function host(url: string) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function SourceLine({ name, url, status }: { name: string; url: string | null; status?: string }) {
  const tc = useTranslations("common");
  return (
    <p className="mt-2 type-small text-cell-muted">
      {name}
      {status && status !== "verified" && <> ({tc(`status.${status as "estimate" | "assumption"}`)})</>}
      {url && (
        <>
          {" "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-cell underline underline-offset-4 hover:no-underline">
            {host(url)}
          </a>
        </>
      )}
    </p>
  );
}

function ConstantValue({ c }: { c: RawConstant }) {
  const lang = useLocale();
  const v = c.value;
  if (typeof v === "number") {
    return (
      <>
        {formatNumber(v, lang, Number.isInteger(v) ? 0 : 3)} <span className="text-cell-muted">{c.unit}</span>
      </>
    );
  }
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return <>{(v as string[]).join(", ")}</>;
  if (Array.isArray(v)) {
    return (
      <>
        {(v as { kw: number; inr: number }[])
          .map((p) => `${formatNumber(p.kw, lang)} kW: ₹${formatNumber(p.inr, lang)}`)
          .join(" · ")}
      </>
    );
  }
  if (v && typeof v === "object") {
    return (
      <>
        {Object.entries(v as Record<string, number>)
          .map(([k, x]) => `${k.replaceAll("_", " ")}: ${formatNumber(x, lang, Number.isInteger(x) ? 0 : 2)}`)
          .join(" · ")}
      </>
    );
  }
  return <>{String(v)}</>;
}

function TariffCard({ tariff }: { tariff: Tariff }) {
  const t = useTranslations("methodologyPage");
  const lang = useLocale();
  const n = (x: number, d = 2) => formatNumber(x, lang, d);
  const comp = (ids: string[]) =>
    ids
      .map((id) => (t.has(`components.${id}`) ? t(`components.${id}`) : id))
      .join(" + ");
  const fc = tariff.fixed_charge;
  let fixed: string;
  if (fc.mode === "per_connection") {
    fixed = t("fixedPerConnection", { single: n(fc.single_phase_inr ?? 0, 0), three: n(fc.three_phase_inr ?? 0, 0) });
  } else if (fc.mode === "by_units") {
    fixed = t("fixedByUnits", {
      tiers: (fc.tiers ?? []).map((x) => n(x.inr, 0)).join(" / ₹"),
      three: n(fc.three_phase_inr ?? 0, 0),
    });
  } else if (fc.mode === "per_kw") {
    fixed = t("fixedPerKw", { rate: n(fc.inr_per_kw ?? 0, 0) });
  } else {
    let lower = 0;
    const bands = (fc.bands ?? [])
      .map((b) => {
        const label = b.upto_kw === null ? `> ${n(lower, 0)} kW` : `${n(lower, 0)}–${n(b.upto_kw, 0)} kW`;
        lower = b.upto_kw ?? lower;
        return `${label}: ₹${n(b.inr_per_kw, 0)}`;
      })
      .join(", ");
    fixed = t("fixedByBand", { bands });
  }
  const extra = fc.extra_above_kw;

  let lower = 0;
  const slabRows = tariff.slabs.map((s) => {
    const label =
      s.upto_units === null
        ? lower === 0
          ? t("allUnits")
          : t("slabAbove", { from: n(lower, 0) })
        : lower === 0
          ? t("slabUpTo", { to: n(s.upto_units, 0) })
          : t("slabRange", { from: n(lower + 1, 0), to: n(s.upto_units, 0) });
    lower = s.upto_units ?? lower;
    return { label, rate: s.energy_inr_per_kwh };
  });

  return (
    <article className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-heading text-xl">{tariff.discom}</h3>
        <p className="type-small text-cell-muted">
          {tariff.category} · FY {tariff.fy}
        </p>
      </header>
      <p className="mt-1 text-sm text-cell-muted">{tariff.name}</p>
      <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
        <dl>
          <dt className="type-small text-cell-muted">{t("slabs")}</dt>
          <dd>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {slabRows.map((r) => (
                  <tr key={r.label} className="border-b border-dashed border-concrete">
                    <td className="py-1.5 pr-4">{r.label}</td>
                    <td className="py-1.5 text-right type-number">{t("ratePerUnit", { rate: n(r.rate) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </dd>
        </dl>
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="type-small text-cell-muted">{t("fixed")}</dt>
            <dd className="mt-1">
              {fixed}
              {extra && (
                <>
                  . {t("extraAboveKw", { inr: n(extra.inr_per_block, 0), block: n(extra.block_kw, 0), above: n(extra.above_kw, 0) })}
                </>
              )}
            </dd>
          </div>
          {(tariff.wheeling_inr_per_kwh ?? 0) > 0 && (
            <div>
              <dt className="type-small text-cell-muted">{t("wheeling")}</dt>
              <dd className="mt-1">{t("ratePerUnit", { rate: n(tariff.wheeling_inr_per_kwh ?? 0) })}</dd>
            </div>
          )}
          {(tariff.per_kwh_adders ?? []).length > 0 && (
            <div>
              <dt className="type-small text-cell-muted">{t("perUnit")}</dt>
              {(tariff.per_kwh_adders ?? []).map((a) => (
                <dd key={a.id} className="mt-1">
                  {a.label}: {t("ratePerUnit", { rate: n(a.inr_per_kwh) })}
                </dd>
              ))}
            </div>
          )}
          {(tariff.percent_charges ?? []).length > 0 && (
            <div>
              <dt className="type-small text-cell-muted">{t("percentCharges")}</dt>
              {(tariff.percent_charges ?? []).map((p) => (
                <dd key={p.id} className="mt-1">
                  {p.label}: {t("pctOf", { pct: n(p.pct, 0), base: comp(p.base) })}
                </dd>
              ))}
            </div>
          )}
          {(tariff.bill_inputs ?? []).length > 0 && (
            <div>
              <dt className="type-small text-cell-muted">{t("fromBill")}</dt>
              {(tariff.bill_inputs ?? []).map((b) => (
                <dd key={b.id} className="mt-1">
                  {b.label}. <span className="text-cell-muted">{b.note}</span>
                </dd>
              ))}
            </div>
          )}
        </dl>
      </div>
      <div className="mt-5 space-y-2 border-t border-concrete pt-4 text-sm">
        <p>
          <span className="text-cell-muted">{t("netMetering")}: </span>
          {tariff.net_metering.note}
        </p>
        {(tariff.notes ?? []).map((note) => (
          <p key={note} className="text-cell-muted">
            {note}
          </p>
        ))}
      </div>
      <SourceLine name={`${tariff.source} ${t("effective", { from: tariff.effective_from })}.`} url={tariff.source_url} />
    </article>
  );
}

function MethodologyContent() {
  const t = useTranslations("methodologyPage");
  const tw = useTranslations("working");
  const lang = useLocale();
  const constants = constantsData.constants as Record<string, RawConstant>;
  const other = Object.keys(constants).filter((k) => !SOLAR_KEYS.includes(k));
  const toc = [
    { id: "solar", label: t("solarTitle") },
    { id: "constants", label: t("constantsTitle") },
    { id: "tariffs", label: t("tariffsTitle") },
    { id: "validation", label: t("validationTitle") },
    { id: "other", label: t("otherFactsTitle") },
  ];

  return (
    <div className="mx-auto grid max-w-[1200px] gap-12 px-4 pb-8 sm:px-6 lg:grid-cols-12">
      <nav aria-labelledby="toc-title" className="lg:col-span-3">
        <div className="lg:sticky lg:top-24">
          <h2 id="toc-title" className="type-small text-cell-muted">
            {t("toc")}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="hover:underline">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="min-w-0 space-y-24 lg:col-span-9">
        <section id="solar" aria-labelledby="solar-title" className="scroll-mt-24">
          <h2 id="solar-title" className="type-heading text-3xl">
            {t("solarTitle")}
          </h2>
          <p className="mt-3 max-w-[68ch] text-cell-muted">{t("solarIntro")}</p>
          <ol className="mt-8 divide-y divide-concrete border-y border-concrete">
            {sample.report.working.map((step, i) => (
              <li key={step.id} id={`step-${step.id}`} className="scroll-mt-24 py-5">
                <p className="type-small text-cell-muted">{tw("step", { n: i + 1 })}</p>
                <h3 className="mt-1 type-heading text-lg">{step.label}</h3>
                <p className="mt-2 max-w-[68ch] first-letter:uppercase">{step.formula}</p>
                {step.source && <SourceLine name={step.source.name} url={step.source.url} status={step.source.status ?? undefined} />}
              </li>
            ))}
          </ol>
        </section>

        <section id="constants" aria-labelledby="constants-title" className="scroll-mt-24">
          <h2 id="constants-title" className="type-heading text-3xl">
            {t("constantsTitle")}
          </h2>
          <p className="mt-3 max-w-[68ch] text-cell-muted">{t("constantsIntro")}</p>
          <dl className="mt-8 divide-y divide-concrete border-y border-concrete">
            {SOLAR_KEYS.map((key) => {
              const c = constants[key]!;
              return (
                <div key={key} id={`c-${key}`} className="grid scroll-mt-24 gap-2 py-5 md:grid-cols-12 md:gap-8">
                  <dt className="type-heading text-base md:col-span-4">{c.label}</dt>
                  <dd className="md:col-span-8">
                    <p className="type-number text-lg">
                      <ConstantValue c={c} />
                    </p>
                    <SourceLine name={`${c.source} (${c.as_of})`} url={c.source_url} status={c.status} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section id="tariffs" aria-labelledby="tariffs-title" className="scroll-mt-24">
          <h2 id="tariffs-title" className="type-heading text-3xl">
            {t("tariffsTitle")}
          </h2>
          <p className="mt-3 max-w-[68ch] text-cell-muted">{t("tariffsIntro")}</p>
          <div className="mt-8 space-y-6">
            {Object.values(TARIFFS).map((tariff) => (
              <TariffCard key={tariff.id} tariff={tariff} />
            ))}
          </div>
        </section>

        <section id="validation" aria-labelledby="validation-title" className="scroll-mt-24">
          <h2 id="validation-title" className="type-heading text-3xl">
            {t("validationTitle")}
          </h2>
          <p className="mt-3 max-w-[68ch] text-cell-muted">{t("pvgisIntro")}</p>
          {/* Focusable so keyboard users can scroll it sideways on a phone */}
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="validation-title"
            className="mt-8 overflow-x-auto rounded-panel border border-concrete bg-parapet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell"
          >
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-concrete text-left type-small text-cell-muted">
                  <th scope="col" className="px-4 py-3 font-normal">{t("pvgisCity")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("pvgisOurs")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("pvgisFlat")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("pvgisTilt")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-normal">{t("pvgisDiff")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-concrete">
                {pvgis.rows.map((r) => (
                  <tr key={r.city}>
                    <th scope="row" className="px-4 py-3 text-left font-normal">{r.city}</th>
                    <td className="px-4 py-3 text-right type-number">{formatNumber(r.groundwork_kwh_per_kw, lang)}</td>
                    <td className="px-4 py-3 text-right type-number">{formatNumber(r.pvgis_flat_kwh_per_kw, lang)}</td>
                    <td className="px-4 py-3 text-right type-number">{formatNumber(r.pvgis_optimal_tilt_kwh_per_kw, lang)}</td>
                    <td className="px-4 py-3 text-right type-number">
                      {r.diff_vs_flat_pct > 0 ? "+" : ""}
                      {formatNumber(r.diff_vs_flat_pct, lang, 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 type-small text-cell-muted">
            {t("pvgisRun", { date: pvgis.run_on, pct: pvgis.target_pct })} {pvgis.method}
          </p>
        </section>

        <section id="other" aria-labelledby="other-title" className="scroll-mt-24">
          <h2 id="other-title" className="type-heading text-3xl">
            {t("otherFactsTitle")}
          </h2>
          <dl className="mt-8 divide-y divide-concrete border-y border-concrete">
            {other.map((key) => {
              const c = constants[key]!;
              return (
                <div key={key} id={`c-${key}`} className="grid scroll-mt-24 gap-2 py-5 md:grid-cols-12 md:gap-8">
                  <dt className="type-heading text-base md:col-span-4">{c.label}</dt>
                  <dd className="md:col-span-8">
                    <p className="type-number text-lg">
                      <ConstantValue c={c} />
                    </p>
                    <SourceLine name={`${c.source} (${c.as_of})`} url={c.source_url} status={c.status} />
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>
    </div>
  );
}

export default async function MethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("methodologyPage");
  return (
    <>
      <PageIntro title={t("title")} intro={t("intro")} />
      <MethodologyContent />
    </>
  );
}
