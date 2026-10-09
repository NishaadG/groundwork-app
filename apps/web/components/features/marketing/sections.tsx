import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { type WorkingStep, WorkingSteps } from "@/components/features/working/working-steps";
import constants from "@/lib/calc/data/constants.json";
import pvgis from "@/lib/calc/data/eval_solar_pvgis.json";
import sample from "@/lib/calc/data/sample_household.json";
import { TARIFFS } from "@/lib/calc/tariff";
import { billBreakdown } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";

const C = constants.constants;

function SectionHeading({ title, intro, id }: { title: string; intro?: string; id?: string }) {
  return (
    <div className="max-w-[44rem]">
      <h2 id={id} className="type-heading text-3xl sm:text-4xl">
        {title}
      </h2>
      {intro && <p className="mt-4 text-lg text-cell-muted">{intro}</p>}
    </div>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="type-small text-cell-muted underline underline-offset-4 hover:text-cell"
    >
      {label}: {new URL(href).hostname.replace(/^www\./, "")}
    </a>
  );
}

export function ResourcePanels() {
  const t = useTranslations("resources");
  const tc = useTranslations("common");
  const lang = useLocale();
  const items = [
    {
      key: "energy",
      rule: "bg-sun",
      fact: t("energy.fact", { amount: formatNumber(C.pm_surya_ghar_subsidy.value.cap_inr, lang) }),
      source: C.pm_surya_ghar_subsidy.source_url,
    },
    {
      key: "water",
      rule: "bg-tank",
      fact: t("water.fact", {
        litres: formatNumber(Math.floor(C.running_toilet_litres_per_day.value / 10) * 10, lang),
      }),
      source: C.running_toilet_litres_per_day.source_url,
    },
    {
      key: "waste",
      rule: "bg-kraft",
      fact: t("waste.fact", { count: C.waste_streams.value.length }),
      source: C.waste_streams.source_url,
    },
  ] as const;

  return (
    <section aria-labelledby="resources-title" className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
      <SectionHeading id="resources-title" title={t("title")} intro={t("intro")} />
      <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
        {items.map((item) => (
          <article key={item.key} className="flex flex-col">
            <div className={cn("h-1 w-full", item.rule)} aria-hidden />
            <h3 className="mt-5 type-ui text-sm text-cell-muted">{t(`${item.key}.name`)}</h3>
            <p className="mt-2 type-number text-4xl leading-none">{item.fact}</p>
            <p className="mt-4 max-w-[38ch] text-cell-muted">{t(`${item.key}.body`)}</p>
            <div className="mt-auto pt-5">
              <SourceLink href={item.source} label={tc("source")} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Small fragments built from real components and the sample household's numbers. */
function FragmentConfirm() {
  const t = useTranslations("steps");
  const lang = useLocale();
  return (
    <div className="rounded-panel border border-concrete bg-parapet p-4">
      <p className="type-small text-cell-muted">{t("fragmentConfirm")}</p>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-input border border-field px-3 py-2">
        <span className="type-number text-lg">
          {t("fragmentConfirmValue", { units: formatNumber(sample.inputs.monthly_units[0]!, lang) })}
        </span>
        <span className="inline-flex items-center gap-1 type-small text-leaf">
          <Check aria-hidden className="size-3.5" strokeWidth={2} />
          {t("fragmentConfidence")}
        </span>
      </div>
    </div>
  );
}

function FragmentSlabs() {
  const t = useTranslations("steps");
  const lang = useLocale();
  const b = billBreakdown(sample.inputs.monthly_units[0]!, TARIFFS[sample.inputs.tariff]!);
  const max = Math.max(...b.slabs.map((s) => s.amount));
  return (
    <div className="rounded-panel border border-concrete bg-parapet p-4">
      <p className="type-small text-cell-muted">{t("fragmentSlabs")}</p>
      <ul className="mt-3 space-y-2">
        {b.slabs.map((s) => (
          <li key={s.from_units} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
            <span className="text-cell-muted">
              {s.to_units === null
                ? t("fragmentSlabTop", { from: s.from_units })
                : t("fragmentSlabLine", { from: s.from_units + 1, to: s.to_units })}
            </span>
            <span className="h-2 rounded-full bg-sun" style={{ width: `${(s.amount / max) * 100}%` }} aria-hidden />
            <span className="type-number">{formatInr(s.amount, lang)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FragmentAction() {
  const t = useTranslations("steps");
  const lang = useLocale();
  return (
    <div className="rounded-panel border border-concrete bg-parapet p-4">
      <p className="type-small text-cell-muted">{t("fragmentAction")}</p>
      <p className="mt-2 flex gap-2">
        <span className="mt-1 size-4 shrink-0 rounded-[4px] border border-field" aria-hidden />
        <span>{t("fragmentActionBody", { kw: formatNumber(sample.report.size_kw, lang, 1) })}</span>
      </p>
    </div>
  );
}

function FragmentLedger() {
  const t = useTranslations("steps");
  const lang = useLocale();
  return (
    <dl className="grid grid-cols-2 divide-x divide-concrete rounded-panel border border-concrete bg-parapet">
      <div className="p-4">
        <dt className="type-small text-cell-muted">{t("fragmentLedgerSaved")}</dt>
        <dd className="mt-1 type-number text-xl text-leaf">{formatInr(sample.report.savings_year1_inr, lang)}</dd>
      </div>
      <div className="p-4">
        <dt className="type-small text-cell-muted">{t("fragmentLedgerCo2")}</dt>
        <dd className="mt-1 type-number text-xl">
          {formatNumber(sample.report.co2_avoided_t_per_year, lang, 1)} t
        </dd>
      </div>
    </dl>
  );
}

export function HowItWorksSteps() {
  const t = useTranslations("steps");
  const steps = [
    { key: "snap", fragment: <FragmentConfirm /> },
    { key: "understand", fragment: <FragmentSlabs /> },
    { key: "act", fragment: <FragmentAction /> },
    { key: "track", fragment: <FragmentLedger /> },
  ] as const;
  return (
    <section aria-labelledby="steps-title" className="border-y border-concrete bg-parapet/50">
      <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
        <SectionHeading id="steps-title" title={t("title")} intro={t("intro")} />
        <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {steps.map((s, i) => (
            <li key={s.key} className="flex flex-col">
              <p className="type-number text-xl text-cell-muted" aria-hidden>
                {i + 1}
              </p>
              <h3 className="mt-2 type-heading text-xl">{t(`${s.key}.title`)}</h3>
              <p className="mt-2 text-cell-muted">{t(`${s.key}.body`)}</p>
              <div className="mt-6 lg:mt-auto lg:pt-6" aria-hidden>
                {s.fragment}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ShowTheWorking() {
  const t = useTranslations("working");
  const lang = useLocale();
  return (
    <section id="working" aria-labelledby="working-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading
        id="working-title"
        title={t("title")}
        intro={t("intro", { kw: formatNumber(sample.report.size_kw, lang, 1) })}
      />
      <WorkingSteps steps={sample.report.working as WorkingStep[]} className="mt-12" />
      <Button asChild variant="secondary" className="mt-10">
        <Link href="/methodology">{t("methodologyLink")}</Link>
      </Button>
    </section>
  );
}

const EXAMPLE_BOARD = [
  { label: "B-104", pct: 18 },
  { label: "A-302", pct: 14 },
  { label: "C-11", pct: 9 },
  { label: "A-201", pct: 7 },
];

export function SocietyPreview() {
  const t = useTranslations("society");
  const tc = useTranslations("common");
  const lang = useLocale();
  return (
    <section aria-labelledby="society-title" className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
      <div className="grid items-start gap-12 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <SectionHeading id="society-title" title={t("title")} intro={t("body")} />
          <Button asChild className="mt-8">
            <Link href="/signup">{t("cta")}</Link>
          </Button>
        </div>
        <figure className="rounded-panel border border-concrete bg-parapet lg:col-span-5 lg:col-start-8">
          <figcaption className="flex items-baseline justify-between gap-4 border-b border-concrete px-5 py-4">
            <span className="type-heading text-base">{t("board")}</span>
            <span className="rounded-input border border-concrete px-2 py-0.5 type-small text-cell-muted">
              {tc("example")}
            </span>
          </figcaption>
          <ol className="divide-y divide-concrete">
            {EXAMPLE_BOARD.map((row, i) => (
              <li key={row.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-5 py-3">
                <span className="type-number text-cell-muted">{i + 1}</span>
                <span>{t("flat", { label: row.label })}</span>
                <span className="type-number text-leaf">{t("improvement", { pct: formatNumber(row.pct, lang) })}</span>
              </li>
            ))}
          </ol>
          <p className="border-t border-concrete px-5 py-3 type-small text-cell-muted">{t("boardNote")}</p>
        </figure>
      </div>
    </section>
  );
}

export function Faq() {
  const t = useTranslations("faq");
  const lang = useLocale();
  const discoms = Object.values(TARIFFS).map((x) => x.discom);
  const list = new Intl.ListFormat(lang === "en" ? "en-IN" : lang, { type: "conjunction" }).format(discoms);
  const maxDiff = Math.max(...pvgis.rows.map((r) => Math.abs(r.diff_vs_flat_pct)));
  const items = [
    { key: "free" },
    { key: "safe" },
    { key: "where", values: { list } },
    { key: "accurate", values: { pct: formatNumber(Math.ceil(maxDiff), lang) } },
    { key: "installers" },
  ] as const;
  return (
    <section aria-labelledby="faq-title" className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionHeading id="faq-title" title={t("title")} />
        </div>
        <Accordion type="single" collapsible className="border-t border-concrete lg:col-span-8">
          {items.map((item) => (
            <AccordionItem key={item.key} value={item.key}>
              <AccordionTrigger>{t(`${item.key}.q`)}</AccordionTrigger>
              <AccordionContent>
                {"values" in item ? t(`${item.key}.a`, item.values) : t(`${item.key}.a`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

export function ClosingCta() {
  const t = useTranslations("closing");
  return (
    <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
      <div className="flex flex-col items-start justify-between gap-6 rounded-panel bg-cell px-6 py-12 text-on-cell sm:px-10 md:flex-row md:items-center">
        <div>
          <h2 className="type-display text-3xl sm:text-4xl">{t("title")}</h2>
          <p className="mt-3 text-on-cell/80">{t("body")}</p>
        </div>
        <Button asChild size="lg" className="bg-on-cell text-cell hover:bg-on-cell/90">
          <Link href="/signup">{t("cta")}</Link>
        </Button>
      </div>
    </section>
  );
}
