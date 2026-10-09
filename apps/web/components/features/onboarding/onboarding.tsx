"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Crosshair, LocateFixed, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { useProfile, useSaveProfile } from "@/components/features/app/use-profile";
import { Stepper } from "@/components/ui/blocks";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClasses } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/primitives";
import { PUBLISHED_LOCALES, LOCALE_NAMES } from "@/i18n/routing";
import { useRouter } from "@/i18n/navigation";
import type { HomeType, Profile, ProfileFields, WaterSource } from "@/lib/api";
import { TARIFFS } from "@/lib/calc/tariff";
import { formatNumber } from "@/lib/format";
import { type LngLat, type Place, polygonAreaSqm, reversePlace, searchPlaces, sqmToSqft, suggestDiscom } from "@/lib/geo";
import { cn } from "@/lib/utils";

const RoofMap = dynamic(() => import("./roof-map").then((m) => m.RoofMap), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-panel sm:h-96" />,
});

const STEPS = ["you", "home", "electricity", "water"] as const;

/** Optional number field: "" → null, otherwise a number within bounds. */
const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(min).max(max).nullable(),
  );

function ChoiceCards<T extends string>({
  name,
  options,
  value,
  onChange,
  legend,
}: {
  name: string;
  options: { value: T; label: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className="type-ui text-sm">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-button border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cell",
              value === o.value ? "border-cell bg-parapet" : "border-field bg-parapet/60 hover:border-cell",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="size-4 accent-[var(--cell)]"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function StepFooter({
  step,
  saving,
  onBack,
  onSkip,
  error,
}: {
  step: number;
  saving: boolean;
  onBack: () => void;
  onSkip?: () => void;
  error: boolean;
}) {
  const t = useTranslations("onboarding");
  const last = step === STEPS.length - 1;
  return (
    <div className="mt-10 border-t border-concrete pt-6">
      {error && (
        <p role="alert" className="mb-4 text-sm text-alert">
          {t("saveError")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t("saving") : last ? t("finish") : t("next")}
        </Button>
        {step > 0 && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
            {t("back")}
          </Button>
        )}
        {onSkip && (
          <Button type="button" variant="link" className="ml-auto" onClick={onSkip} disabled={saving}>
            {t("skip")}
          </Button>
        )}
      </div>
    </div>
  );
}

interface StepProps {
  profile: Profile;
  step: number;
  saving: boolean;
  error: boolean;
  save: (fields: ProfileFields, advance?: boolean) => void;
  back: () => void;
}

/* ---- Step 1: you (required) ---- */
function StepYou({ profile, step, saving, error, save, back }: StepProps) {
  const t = useTranslations("onboarding");
  const schema = z.object({ name: z.string().trim().min(1).max(80), lang: z.enum(["en", "hi", "mr"]) });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: profile.name ?? "", lang: profile.lang ?? "en" },
  });
  return (
    <form onSubmit={form.handleSubmit((v) => save(v))} noValidate>
      <h1 className="type-display text-3xl sm:text-4xl">{t("you.title")}</h1>
      <div className="mt-8 grid gap-6">
        <Field id="name" label={t("you.name")} hint={t("you.nameHint")} error={form.formState.errors.name && t("errors.name")}>
          <Input autoComplete="name" {...form.register("name")} />
        </Field>
        {PUBLISHED_LOCALES.length > 1 && (
          <Controller
            control={form.control}
            name="lang"
            render={({ field }) => (
              <ChoiceCards
                name="lang"
                legend={t("you.lang")}
                value={field.value}
                onChange={field.onChange}
                options={PUBLISHED_LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
              />
            )}
          />
        )}
      </div>
      <StepFooter step={step} saving={saving} error={error} onBack={back} />
    </form>
  );
}

/* ---- Step 2: home ---- */
function StepHome({ profile, step, saving, error, save, back }: StepProps) {
  const t = useTranslations("onboarding");
  const lang = useLocale();
  const [homeType, setHomeType] = useState<HomeType | null>(profile.home_type ?? null);
  const [pin, setPin] = useState<LngLat | null>(
    profile.lat != null && profile.lng != null ? [profile.lng, profile.lat] : null,
  );
  const [place, setPlace] = useState<{ city: string | null; state: string | null }>({
    city: profile.city ?? null,
    state: profile.state ?? null,
  });
  const [query, setQuery] = useState(profile.city ?? "");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "busy" | "error">("idle");
  const [locating, setLocating] = useState<"idle" | "busy" | "denied">("idle");
  const [measuring, setMeasuring] = useState(false);
  const [polygon, setPolygon] = useState<LngLat[]>([]);
  const [roof, setRoof] = useState(profile.roof_area_sqft != null ? String(profile.roof_area_sqft) : "");
  const [household, setHousehold] = useState(profile.household_size != null ? String(profile.household_size) : "");
  const [errors, setErrors] = useState<{ roof?: boolean; household?: boolean }>({});
  const abort = useRef<AbortController | null>(null);

  const reverse = (p: LngLat) => {
    abort.current?.abort();
    abort.current = new AbortController();
    reversePlace(p[1], p[0], lang, abort.current.signal)
      .then((r) => r && setPlace({ city: r.city, state: r.state }))
      .catch(() => undefined);
  };

  const onSearch = async () => {
    if (query.trim().length < 2) return;
    setSearchState("busy");
    try {
      setResults(await searchPlaces(query.trim(), lang));
      setSearchState("idle");
    } catch {
      setSearchState("error");
    }
  };

  const useLocation = () => {
    if (!navigator.geolocation) return setLocating("denied");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setPin(p);
        reverse(p);
        setLocating("idle");
      },
      () => setLocating("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const finishMeasure = () => {
    setMeasuring(false);
    if (polygon.length >= 3) setRoof(String(Math.round(sqmToSqft(polygonAreaSqm(polygon)))));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const roofN = roof.trim() === "" ? null : Number(roof);
    const hh = household.trim() === "" ? null : Number(household);
    const next = {
      roof: roofN !== null && (!Number.isFinite(roofN) || roofN < 10 || roofN > 200_000),
      household: hh !== null && (!Number.isInteger(hh) || hh < 1 || hh > 40),
    };
    setErrors(next);
    if (next.roof || next.household) return;
    save({
      home_type: homeType,
      city: place.city,
      state: place.state,
      lat: pin ? Number(pin[1].toFixed(6)) : null,
      lng: pin ? Number(pin[0].toFixed(6)) : null,
      roof_area_sqft: roofN,
      household_size: hh,
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1 className="type-display text-3xl sm:text-4xl">{t("home.title")}</h1>
      <div className="mt-8 grid gap-8">
        <ChoiceCards
          name="home_type"
          legend={t("home.type")}
          value={homeType}
          onChange={setHomeType}
          options={(["flat", "independent_house", "bungalow"] as const).map((v) => ({ value: v, label: t(`home.types.${v}`) }))}
        />

        <div>
          <label htmlFor="city" className="type-ui text-sm">
            {t("home.city")}
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="city"
              className={inputClasses}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSearch();
                }
              }}
              aria-describedby="city-hint"
              autoComplete="address-level2"
            />
            <Button type="button" variant="secondary" onClick={() => void onSearch()} disabled={searchState === "busy"}>
              <Search aria-hidden strokeWidth={1.75} />
              {searchState === "busy" ? t("home.searching") : t("home.search")}
            </Button>
          </div>
          <p id="city-hint" className="mt-1.5 type-small text-cell-muted">
            {t("home.cityHint")}
          </p>
          <div aria-live="polite">
            {searchState === "error" && <p className="mt-2 text-sm text-alert">{t("home.searchError")}</p>}
            {results && results.length === 0 && <p className="mt-2 text-sm text-cell-muted">{t("home.noResults")}</p>}
            {results && results.length > 0 && (
              <ul className="mt-2 divide-y divide-concrete rounded-input border border-concrete bg-parapet">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button
                      type="button"
                      className="w-full cursor-pointer px-3 py-2.5 text-left text-sm hover:bg-limewash"
                      onClick={() => {
                        setPin([r.lng, r.lat]);
                        setPlace({ city: r.city, state: r.state });
                        setQuery(r.city ?? r.label);
                        setResults(null);
                      }}
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="type-ui text-sm">{t("home.pin")}</p>
              <p className="type-small text-cell-muted">{measuring ? t("home.measureHint") : t("home.pinHint")}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={useLocation} disabled={locating === "busy"}>
              <LocateFixed aria-hidden strokeWidth={1.75} />
              {locating === "busy" ? t("home.locating") : t("home.useLocation")}
            </Button>
          </div>
          {locating === "denied" && <p className="mt-2 text-sm text-alert">{t("home.locationDenied")}</p>}
          <div className="mt-3">
            <RoofMap
              pin={pin}
              onPinChange={(p) => {
                setPin(p);
                reverse(p);
              }}
              measuring={measuring}
              polygon={polygon}
              onPolygonChange={setPolygon}
              onPolygonClose={finishMeasure}
              label={t("home.mapLabel")}
            />
          </div>
          {place.city && (
            <p className="mt-2 type-small text-cell-muted">
              {[place.city, place.state].filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        <div>
          <Field
            id="roof"
            label={t("home.roof")}
            hint={t("home.roofHint")}
            optionalLabel={t("optional")}
            error={errors.roof ? t("errors.roof") : undefined}
          >
            <Input inputMode="decimal" value={roof} onChange={(e) => setRoof(e.target.value)} className="max-w-48" />
          </Field>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!measuring ? (
              <Button type="button" variant="secondary" size="sm" disabled={!pin} onClick={() => { setPolygon([]); setMeasuring(true); }}>
                <Crosshair aria-hidden strokeWidth={1.75} />
                {t("home.measure")}
              </Button>
            ) : (
              <>
                <Button type="button" size="sm" onClick={finishMeasure} disabled={polygon.length < 3}>
                  {t("home.measureDone")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPolygon([])}>
                  {t("home.measureClear")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setMeasuring(false); setPolygon([]); }}>
                  {t("home.measureCancel")}
                </Button>
              </>
            )}
            {!measuring && polygon.length >= 3 && (
              <span className="type-small text-cell-muted" aria-live="polite">
                {t("home.measured", { sqft: formatNumber(Math.round(sqmToSqft(polygonAreaSqm(polygon))), lang) })}
              </span>
            )}
          </div>
        </div>

        <Field
          id="household"
          label={t("home.household")}
          optionalLabel={t("optional")}
          error={errors.household ? t("errors.household") : undefined}
        >
          <Input inputMode="numeric" value={household} onChange={(e) => setHousehold(e.target.value)} className="max-w-32" />
        </Field>
      </div>
      <StepFooter step={step} saving={saving} error={error} onBack={back} onSkip={() => save({}, true)} />
    </form>
  );
}

/* ---- Step 3: electricity ---- */
function StepElectricity({ profile, step, saving, error, save, back }: StepProps) {
  const t = useTranslations("onboarding");
  const suggested = useMemo(() => suggestDiscom(profile.state, profile.city), [profile.state, profile.city]);
  const schema = z.object({
    discom: z.string().nullable(),
    supply: z.enum(["single", "three"]),
    sanctioned_load_kw: optionalNumber(0.1, 200),
    approx_monthly_bill_inr: optionalNumber(0, 1_000_000),
  });
  type Values = z.input<typeof schema>;
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      discom: profile.discom ?? suggested,
      supply: profile.supply ?? "single",
      sanctioned_load_kw: profile.sanctioned_load_kw ?? "",
      approx_monthly_bill_inr: profile.approx_monthly_bill_inr ?? "",
    },
  });
  const options = [
    ...Object.values(TARIFFS).map((x) => ({ value: x.id, label: x.discom })),
    { value: "other", label: t("electricity.discomOther") },
  ];
  return (
    <form onSubmit={form.handleSubmit((v) => save(v))} noValidate>
      <h1 className="type-display text-3xl sm:text-4xl">{t("electricity.title")}</h1>
      <div className="mt-8 grid gap-6">
        <Field
          id="discom"
          label={t("electricity.discom")}
          hint={suggested && suggested !== "other" && profile.state ? t("electricity.suggested", { state: profile.state }) : t("electricity.discomHint")}
        >
          <select className={inputClasses} {...form.register("discom", { setValueAs: (v: string) => (v === "" ? null : v) })}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Controller
          control={form.control}
          name="supply"
          render={({ field }) => (
            <ChoiceCards
              name="supply"
              legend={t("electricity.supply")}
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: "single", label: t("electricity.supplySingle") },
                { value: "three", label: t("electricity.supplyThree") },
              ]}
            />
          )}
        />
        <Field
          id="load"
          label={t("electricity.load")}
          hint={t("electricity.loadHint")}
          optionalLabel={t("optional")}
          error={form.formState.errors.sanctioned_load_kw && t("errors.load")}
        >
          <Input inputMode="decimal" className="max-w-32" {...form.register("sanctioned_load_kw")} />
        </Field>
        <Field
          id="bill"
          label={t("electricity.bill")}
          hint={t("electricity.billHint")}
          optionalLabel={t("optional")}
          error={form.formState.errors.approx_monthly_bill_inr && t("errors.bill")}
        >
          <Input inputMode="numeric" className="max-w-40" {...form.register("approx_monthly_bill_inr")} />
        </Field>
      </div>
      <StepFooter step={step} saving={saving} error={error} onBack={back} onSkip={() => save({}, true)} />
    </form>
  );
}

/* ---- Step 4: water ---- */
function StepWater({ profile, step, saving, error, save, back }: StepProps) {
  const t = useTranslations("onboarding");
  const [source, setSource] = useState<WaterSource | null>(profile.water_source ?? null);
  const [tank, setTank] = useState(profile.tank_litres != null ? String(profile.tank_litres) : "");
  const [tankError, setTankError] = useState(false);
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = tank.trim() === "" ? null : Number(tank);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1_000_000)) return setTankError(true);
    setTankError(false);
    save({ water_source: source, tank_litres: n, onboarding_done: true });
  };
  return (
    <form onSubmit={onSubmit} noValidate>
      <h1 className="type-display text-3xl sm:text-4xl">{t("water.title")}</h1>
      <div className="mt-8 grid gap-6">
        <ChoiceCards
          name="water_source"
          legend={t("water.source")}
          value={source}
          onChange={setSource}
          options={(["municipal", "borewell", "tanker", "mixed"] as const).map((v) => ({ value: v, label: t(`water.sources.${v}`) }))}
        />
        <Field id="tank" label={t("water.tank")} hint={t("water.tankHint")} optionalLabel={t("optional")} error={tankError ? t("errors.tank") : undefined}>
          <Input inputMode="numeric" className="max-w-40" value={tank} onChange={(e) => setTank(e.target.value)} />
        </Field>
      </div>
      <StepFooter step={step} saving={saving} error={error} onBack={back} onSkip={() => save({ onboarding_done: true }, true)} />
    </form>
  );
}

export function Onboarding() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const profile = useProfile();
  const mutation = useSaveProfile();
  const [step, setStep] = useState<number | null>(null);

  // Resume where the user left off (save-as-you-go)
  useEffect(() => {
    if (profile.data && step === null) {
      setStep(Math.min(profile.data.onboarding_step ?? 0, STEPS.length - 1));
    }
  }, [profile.data, step]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  if (!profile.data || step === null) return <Skeleton className="h-96 w-full" />;

  const save = (fields: ProfileFields) => {
    const nextStep = Math.min(step + 1, STEPS.length);
    mutation.mutate(
      { ...fields, onboarding_step: Math.min(nextStep, STEPS.length - 1) },
      {
        onSuccess: (p) => {
          if (p.onboarding_done) router.replace("/app");
          else setStep(nextStep);
        },
      },
    );
  };

  const props: StepProps = {
    profile: profile.data,
    step,
    saving: mutation.isPending,
    error: mutation.isError,
    save,
    back: () => setStep(Math.max(0, step - 1)),
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Stepper steps={STEPS.map((s) => t(`steps.${s}`))} current={step} label={t("stepsLabel")} />
      <div className="mt-10">
        {step === 0 && <StepYou {...props} />}
        {step === 1 && <StepHome {...props} />}
        {step === 2 && <StepElectricity {...props} />}
        {step === 3 && <StepWater {...props} />}
      </div>
    </div>
  );
}
