"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, Check, Copy } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Meter, Tank } from "@/components/brand/resource-kit";
import { BillsChart } from "@/components/charts/bills-chart";
import { ChartFrame } from "@/components/charts/chart-frame";
import { PageHeader } from "@/components/features/app/app-shell";
import { useProfile } from "@/components/features/app/use-profile";
import { HowCalculated } from "@/components/features/working/how-calculated";
import { EmptyState, ResourceTag } from "@/components/ui/blocks";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/primitives";
import {
  addWaterReading,
  ApiFailure,
  createDevice,
  finishLeakCheck,
  getWater,
  type LeakCheckResult,
  markLeakFixed,
  presignUpload,
  readMeterPhoto,
  startLeakCheck,
  uploadToS3,
  type WaterSummary,
} from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "meter" | "tank";

function localInput(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function ReadingFields({
  kind,
  setKind,
  value,
  setValue,
  at,
  setAt,
  error,
  lockKind,
  idPrefix,
  hasTank,
}: {
  kind: Kind;
  setKind: (k: Kind) => void;
  value: string;
  setValue: (v: string) => void;
  at: string;
  setAt: (v: string) => void;
  error?: string;
  lockKind?: boolean;
  idPrefix: string;
  hasTank: boolean;
}) {
  const t = useTranslations("water.check");
  const ta = useTranslations("water.add");
  return (
    <div className="grid gap-4">
      {!lockKind && (
        <fieldset>
          <legend className="type-ui text-sm">{t("kind")}</legend>
          <div className="mt-2 flex gap-2">
            {(["meter", "tank"] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  "flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-button border px-3 text-sm",
                  kind === k ? "border-cell bg-parapet" : "border-field bg-parapet/60",
                  k === "tank" && !hasTank && "opacity-60",
                )}
              >
                <input type="radio" name={`${idPrefix}-kind`} checked={kind === k} disabled={k === "tank" && !hasTank} onChange={() => setKind(k)} className="size-4 accent-[var(--cell)]" />
                {k === "meter" ? t("kindMeter") : t("kindTank")}
              </label>
            ))}
          </div>
          {!hasTank && <p className="mt-1 type-small text-cell-muted">{t("needTank")}</p>}
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${idPrefix}-value`} label={kind === "meter" ? t("meterValue") : t("tankValue")} hint={kind === "meter" ? t("meterHint") : t("tankHint")} error={error}>
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="type-number" />
        </Field>
        <Field id={`${idPrefix}-at`} label={ta("time")}>
          <Input type="datetime-local" value={at} max={localInput()} onChange={(e) => setAt(e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function LeakCheck({ data, hasTank }: { data: WaterSummary; hasTank: boolean }) {
  const t = useTranslations("water.check");
  const lang = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const open = data.open_check;
  const [kind, setKind] = useState<Kind>(open?.kind ?? (data.kind ?? "meter"));
  const [value, setValue] = useState("");
  const [at, setAt] = useState(localInput());
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<LeakCheckResult | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["water"] });

  const submit = useMutation({
    mutationFn: async () => {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n) || n < 0 || (kind === "tank" && n > 100)) throw new Error("value");
      const when = new Date(at).toISOString();
      return open ? finishLeakCheck(open.id, n, when) : startLeakCheck(kind, n, when).then(() => null);
    },
    onSuccess: async (r) => {
      setError(undefined);
      setValue("");
      setAt(localInput());
      if (r) setResult(r);
      await refresh();
    },
    onError: (err) =>
      setError(err instanceof ApiFailure && err.code === "check_window" ? t("windowError") : t("error")),
  });

  const rate = profile?.water_inr_per_kl;
  return (
    <section aria-labelledby="leak-check" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="leak-check" className="type-heading text-xl">
        {t("title")}
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm text-cell-muted">{t("intro")}</p>

      {result && (
        <div role="status" className={cn("mt-5 rounded-input border px-4 py-3", result.leak ? "border-alert/50 bg-alert/5" : "border-leaf/40")}>
          {result.leak ? (
            <>
              <p className="flex items-center gap-2 type-heading text-lg text-alert">
                <AlertTriangle aria-hidden className="size-5" strokeWidth={2} />
                {t("leakTitle", { litres: formatNumber(result.result.litres_per_day, lang) })}
              </p>
              <p className="mt-1 text-sm">
                {t("leakBody", { month: formatNumber(result.result.litres_per_day * 30, lang) })}{" "}
                {rate ? t("leakMoney", { inr: formatInr((result.result.litres_per_day * 30 * rate) / 1000, lang) }) : null}
              </p>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 type-heading text-lg text-leaf">
                <Check aria-hidden className="size-5" strokeWidth={2} />
                {t("noLeakTitle")}
              </p>
              <p className="mt-1 text-sm text-cell-muted">{t("noLeakBody")}</p>
            </>
          )}
          <div className="mt-2">
            <HowCalculated steps={[result.result.working]} title={t("title")} />
          </div>
        </div>
      )}

      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
        noValidate
      >
        <h3 className="type-ui text-sm">{open ? t("finishTitle") : t("startTitle")}</h3>
        {open && (
          <p className="mt-1 type-small text-cell-muted">
            {t("openNote", { time: format.dateTime(new Date(open.night_at), { dateStyle: "medium", timeStyle: "short" }) })}
          </p>
        )}
        <div className="mt-3">
          <ReadingFields kind={open?.kind ?? kind} setKind={setKind} value={value} setValue={setValue} at={at} setAt={setAt} error={error} lockKind={Boolean(open)} idPrefix="check" hasTank={hasTank} />
        </div>
        <Button type="submit" className="mt-4" disabled={submit.isPending}>
          {open ? t("finish") : t("start")}
        </Button>
      </form>
    </section>
  );
}

function Leaks({ events }: { events: WaterSummary["events"] }) {
  const t = useTranslations("water.hunt");
  const tw = useTranslations("water");
  const lang = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const fix = useMutation({ mutationFn: markLeakFixed, onSuccess: () => qc.invalidateQueries({ queryKey: ["water"] }) });
  if (events.length === 0) return null;
  const date = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium" });
  return (
    <section aria-labelledby="leaks" className="space-y-4">
      {events.map((e) => (
        <article key={e.id} className={cn("rounded-panel border bg-parapet p-5 sm:p-6", e.status === "open" ? "border-alert/50" : "border-concrete")}>
          <h2 id={e.status === "open" ? "leaks" : undefined} className="flex items-center gap-2 type-heading text-lg">
            {e.status === "open" && <AlertTriangle aria-hidden className="size-5 text-alert" strokeWidth={2} />}
            {tw("leakDetected", { date: date(e.detected_at), litres: formatNumber(e.litres_per_day, lang) })}
          </h2>
          {e.working && (
            <div className="mt-1">
              <HowCalculated steps={[e.working]} />
            </div>
          )}
          {e.status === "open" ? (
            <>
              <h3 className="mt-4 type-ui text-sm">{t("title")}</h3>
              <p className="text-sm text-cell-muted">{t("intro")}</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
                {(["toilet", "float", "taps", "pipes"] as const).map((k) => (
                  <li key={k}>{t(k)}</li>
                ))}
              </ol>
              <Button className="mt-4" disabled={fix.isPending} onClick={() => fix.mutate(e.id)}>
                {t("fixed")}
              </Button>
            </>
          ) : (
            <div className="mt-2 text-sm">
              <p className="text-cell-muted">{t("fixedDone", { date: date(e.fixed_at!) })}</p>
              {e.saved ? (
                e.saved.counted ? (
                  <p className="mt-1 type-number text-lg text-leaf">{t("saved", { litres: formatNumber(e.saved.litres, lang) })}</p>
                ) : (
                  <p className="mt-1 text-cell-muted">{t("noDrop")}</p>
                )
              ) : (
                <p className="mt-1 text-cell-muted">{t("notYet")}</p>
              )}
              {e.saved && (
                <div className="mt-1">
                  <HowCalculated steps={[e.saved.working]} />
                </div>
              )}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function AddReading({ data, hasTank }: { data: WaterSummary; hasTank: boolean }) {
  const t = useTranslations("water.add");
  const tc = useTranslations("water.check");
  const lang = useLocale();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(data.kind ?? "meter");
  const [value, setValue] = useState("");
  const [at, setAt] = useState(localInput());
  const [error, setError] = useState<string | undefined>();
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [source, setSource] = useState<"manual" | "photo">("manual");
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () => {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n) || n < 0 || (kind === "tank" && n > 100)) throw new Error("value");
      return addWaterReading(kind, n, new Date(at).toISOString(), source);
    },
    onSuccess: async () => {
      toast(t("saved"));
      setValue("");
      setAt(localInput());
      setPhotoNote(null);
      setSource("manual");
      setError(undefined);
      await qc.invalidateQueries({ queryKey: ["water"] });
    },
    onError: () => setError(tc("error")),
  });
  const onPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoNote(t("photoReading"));
    try {
      const p = await presignUpload("meter", file.type);
      await uploadToS3(p, file);
      const r = await readMeterPhoto(p.key);
      if (r.litres === null) throw new Error("unread");
      setKind("meter");
      setValue(String(r.litres));
      setSource("photo");
      setPhotoNote(t("photoRead", { litres: formatNumber(r.litres, lang) }));
    } catch (err) {
      setPhotoNote(err instanceof ApiFailure && err.code === "ai_unavailable" ? t("photoUnavailable") : t("photoFailed"));
    }
  };
  return (
    <section aria-labelledby="add-reading" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="add-reading" className="type-heading text-xl">
        {t("title")}
      </h2>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        noValidate
      >
        <ReadingFields kind={kind} setKind={setKind} value={value} setValue={setValue} at={at} setAt={setAt} error={error} idPrefix="add" hasTank={hasTank} />
        {photoNote && (
          <p role="status" className="mt-3 text-sm text-cell-muted">
            {photoNote}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="submit" disabled={save.isPending}>
            {t("save")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Camera aria-hidden strokeWidth={1.75} />
            {t("photo")}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden data-testid="meter-file" onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>
      </form>
    </section>
  );
}

function SmartMeter({ data }: { data: WaterSummary }) {
  const t = useTranslations("water.stream");
  const lang = useLocale();
  const format = useFormatter();
  const [name, setName] = useState("Smart meter");
  const [key, setKey] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => createDevice(name), onSuccess: (d) => setKey(d.key) });
  return (
    <section aria-labelledby="smart-meter" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="smart-meter" className="type-heading text-xl">
        {t("title")}
      </h2>
      {data.stream ? (
        <>
          <p className="mt-2 inline-flex rounded-input border border-concrete px-2 py-0.5 type-small text-cell-muted">{t("label")}</p>
          <p className="mt-2 text-sm text-cell-muted">
            {t("last", {
              time: format.dateTime(new Date(data.stream.last_at), { dateStyle: "medium", timeStyle: "short" }),
              count: formatNumber(data.stream.count, lang),
            })}
          </p>
          {data.stream.nights.length > 0 && (
            <>
              <h3 className="mt-4 type-ui text-sm">{t("nightsTitle")}</h3>
              <ul className="mt-2 divide-y divide-concrete border-y border-concrete text-sm">
                {data.stream.nights.map((n) => (
                  <li key={n.night} className="flex justify-between gap-4 py-2">
                    <span>{format.dateTime(new Date(n.night), { dateStyle: "medium" })}</span>
                    <span className={n.leak ? "text-alert" : "text-cell-muted"}>
                      {n.leak ? t("nightLeak", { litres: formatNumber(n.litres_per_day, lang) }) : t("nightOk")}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="mt-2 max-w-[60ch] text-sm text-cell-muted">{t("intro")}</p>
      )}
      {key ? (
        <div role="status" className="mt-4 rounded-input border border-cell/30 p-3">
          <p className="type-ui text-sm">{t("keyTitle")}</p>
          <code className="mt-1 block break-all text-sm">{key}</code>
          <p className="mt-1 type-small text-cell-muted">{t("keyBody")}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => navigator.clipboard.writeText(key).then(() => toast(t("copied")))}
          >
            <Copy aria-hidden strokeWidth={1.75} />
            {t("copy")}
          </Button>
        </div>
      ) : (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field id="device-name" label={t("deviceName")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Button type="submit" variant="secondary" disabled={create.isPending || !name.trim()}>
            {t("addDevice")}
          </Button>
        </form>
      )}
    </section>
  );
}

export function WaterPage() {
  const t = useTranslations("water");
  const tc = useTranslations("common");
  const lang = useLocale();
  const format = useFormatter();
  const { data: profile } = useProfile();
  const q = useQuery({ queryKey: ["water"], queryFn: getWater });
  const hasTank = Boolean(profile?.tank_litres);
  if (q.isPending || !profile) return <Skeleton className="mx-auto h-96 max-w-[1200px]" />;
  if (q.isError) return <p role="alert" className="text-alert">{t("check.error")}</p>;
  const d = q.data;
  const people = profile.household_size ?? 0;
  const points = d.series.map((s) => ({ label: format.dateTime(new Date(s.day), { day: "numeric", month: "short" }), value: s.litres }));
  const hasData = d.series.length > 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader title={t("title")}>
        <ResourceTag resource="water">{t("title")}</ResourceTag>
      </PageHeader>

      <section className="grid gap-6 lg:grid-cols-12">
        <div className="flex items-center justify-center rounded-panel border border-concrete bg-parapet p-5 lg:col-span-4">
          {d.tank ? (
            <Tank fillPct={d.tank.level_pct} title={t("tankTitle", { pct: formatNumber(d.tank.level_pct, lang) })} className="h-44 w-auto" />
          ) : (
            <Meter
              reading={String(Math.round((d.latest.find((r) => r.kind === "meter")?.value ?? 0) / 1000) * 100).padStart(6, "0")}
              title={t("meterTitle")}
              className="h-44 w-auto"
            />
          )}
        </div>
        <div className={cn("grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-concrete bg-concrete lg:col-span-8", d.tank ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
          <div className="bg-parapet p-5">
            <Readout
              label={t("perDay")}
              value={
                d.litres_per_day === null ? "—" : (
                  <>
                    {formatNumber(d.litres_per_day, lang)}
                    <span className="ml-1.5 type-small font-normal text-cell-muted">{t("litres")}</span>
                  </>
                )
              }
            />
            <p className="mt-2 type-small text-cell-muted">{t("perDayNote")}</p>
          </div>
          <div className="bg-parapet p-5">
            <Readout label={t("perPerson")} value={d.lpcd ? formatNumber(d.lpcd.lpcd, lang) : "—"} />
            {d.lpcd && (
              <>
                <p className="mt-2 type-small text-cell-muted">{t("benchmark", { lpcd: formatNumber(d.lpcd.benchmark, lang) })}</p>
                <div className="mt-1">
                  <HowCalculated steps={[d.lpcd.working]} />
                </div>
              </>
            )}
          </div>
          {d.tank && (
          <div className="bg-parapet p-5">
            <Readout
              label={t("daysLeft")}
              value={
                d.forecast?.days_to_empty != null ? (
                  <>
                    {formatNumber(d.forecast.days_to_empty, lang, 1)}
                    <span className="ml-1.5 type-small font-normal text-cell-muted">{t("days")}</span>
                  </>
                ) : (
                  "—"
                )
              }
            />
            {d.forecast?.tankers_needed != null && (
              <p className="mt-2 type-small text-cell-muted">
                {t("tankers", { count: d.forecast.tankers_needed })}
                {d.forecast.tanker_cost_inr ? `, ${t("tankerCost", { inr: formatInr(d.forecast.tanker_cost_inr, lang) })}` : ""}
              </p>
            )}
            {d.forecast && (
              <div className="mt-1">
                <HowCalculated steps={[d.forecast.working]} />
              </div>
            )}
          </div>
          )}
        </div>
      </section>

      <Leaks events={d.events} />

      <div className="grid gap-6 lg:grid-cols-2">
        <LeakCheck data={d} hasTank={hasTank} />
        <AddReading data={d} hasTank={hasTank} />
      </div>

      {hasData ? (
        <ChartFrame
          title={t("usageTitle")}
          source={t("usageNote")}
          tableLabel={tc("showTable")}
          chartLabel={tc("showChart")}
          table={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-concrete text-left type-small text-cell-muted">
                  <th scope="col" className="py-2 font-normal">{t("day")}</th>
                  <th scope="col" className="py-2 text-right font-normal">{t("litres")}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={i} className="border-b border-dashed border-concrete">
                    <th scope="row" className="py-1.5 text-left font-normal">{p.label}</th>
                    <td className="py-1.5 text-right type-number">{formatNumber(p.value, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <BillsChart
            points={points}
            title={t("usageTitle")}
            unitLabel={t("litres")}
            color="var(--chart-water)"
            reference={people && d.lpcd ? { value: people * d.lpcd.benchmark, label: t("benchmarkLine", { people }) } : undefined}
          />
          {d.anomalies.length > 0 && (
            <p className="mt-3 text-sm text-alert">
              {t("anomalyNote", { days: d.anomalies.map((a) => format.dateTime(new Date(a.day), { day: "numeric", month: "short" })).join(", ") })}
            </p>
          )}
        </ChartFrame>
      ) : (
        <EmptyState title={t("emptyTitle")} body={t("emptyBody")} art={<Tank fillPct={30} title={t("emptyTitle")} className="h-24 w-auto" />} />
      )}

      <SmartMeter data={d} />
    </div>
  );
}
