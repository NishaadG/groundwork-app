"use client";

import { AlertTriangle, Camera, Check, FileUp, Loader2, Minus, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { useProfile } from "@/components/features/app/use-profile";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClasses } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/primitives";
import { useRouter } from "@/i18n/navigation";
import {
  ApiFailure,
  type BillIn,
  type Confidence,
  createReport,
  type Extraction,
  extractBill,
  presignUpload,
  saveBill,
  type Shading,
  uploadToS3,
} from "@/lib/api";
import { TARIFFS } from "@/lib/calc/tariff";
import { type LngLat, polygonAreaSqm, sqmToSqft } from "@/lib/geo";
import { cn } from "@/lib/utils";

const RoofMap = dynamic(() => import("@/components/features/onboarding/roof-map").then((m) => m.RoofMap), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full rounded-panel sm:h-96" />,
});

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type Stage = "choose" | "working" | "confirm" | "roof";
type WorkStep = "uploading" | "reading" | "checking";

interface Draft {
  discom: string;
  units: string;
  start: string;
  end: string;
  amount: string;
  load: string;
  supply: "single" | "three";
  charges: Record<string, string>;
  history: { month: string; units: string }[];
  confidence: Record<string, Confidence>;
  issues: Record<string, string>;
  evidence: Record<string, string>;
  name: string | null;
  source: "manual" | "photo";
  s3Key: string | null;
  saved: boolean;
}

function emptyDraft(discom: string | null | undefined, load: number | null | undefined, supply: "single" | "three" | null | undefined): Draft {
  return {
    discom: discom ?? "",
    units: "",
    start: "",
    end: "",
    amount: "",
    load: load != null ? String(load) : "",
    supply: supply ?? "single",
    charges: {},
    history: [],
    confidence: {},
    issues: {},
    evidence: {},
    name: null,
    source: "manual",
    s3Key: null,
    saved: false,
  };
}

/** Field name in the extraction → field in the draft */
const FIELD_MAP: Record<string, keyof Draft> = {
  units_consumed_kwh: "units",
  billing_period_start: "start",
  billing_period_end: "end",
  total_amount_inr: "amount",
  sanctioned_load_kw: "load",
  discom: "discom",
};

function draftFromExtraction(e: Extraction, base: Draft, s3Key: string): Draft {
  const d: Draft = { ...base, source: "photo", s3Key, saved: e.sample === true, confidence: {}, issues: {}, evidence: {} };
  for (const [src, dst] of Object.entries(FIELD_MAP)) {
    const f = e.fields[src];
    if (!f) continue;
    if (dst === "discom") {
      if (e.discom_id) d.discom = e.discom_id;
    } else if (f.value !== null && f.value !== undefined) {
      (d[dst] as string) = String(f.value);
    }
    d.confidence[dst] = dst === "discom" && !e.discom_id ? "low" : f.confidence;
    if (f.issue) d.issues[dst] = f.issue;
    if (f.evidence) d.evidence[dst] = f.evidence;
  }
  const phase = e.fields.supply_phase?.value;
  if (phase === "single" || phase === "three") d.supply = phase;
  // A fuel adjustment amount on the bill becomes a per-unit rate for the tariff
  const fac = Number(e.fields.fac_amount_inr?.value);
  const units = Number(d.units);
  const tariff = TARIFFS[d.discom];
  const facInput = tariff?.bill_inputs?.find((b) => b.id === "fac" || b.id === "fppca");
  if (facInput && fac > 0 && units > 0) d.charges[facInput.id] = (fac / units).toFixed(2);
  d.history = e.history.map((h) => ({ month: h.month, units: String(h.units) }));
  d.name = e.consumer_name_masked;
  return d;
}

function Steps({ current, failed }: { current: WorkStep; failed: boolean }) {
  const t = useTranslations("solar.new.steps");
  const order: WorkStep[] = ["uploading", "reading", "checking"];
  const idx = order.indexOf(current);
  return (
    <ol className="space-y-3" aria-live="polite">
      {order.map((s, i) => (
        <li key={s} className={cn("flex items-center gap-3", i > idx && "text-cell-muted")}>
          {i < idx ? (
            <Check aria-hidden className="size-5 text-leaf" strokeWidth={2} />
          ) : i === idx && !failed ? (
            <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} />
          ) : (
            <span aria-hidden className="size-5 rounded-full border border-concrete-strong" />
          )}
          <span className={cn(i === idx && "type-ui")}>{t(s)}</span>
        </li>
      ))}
    </ol>
  );
}

function CheckNote({ draft, field }: { draft: Draft; field: keyof Draft }) {
  const t = useTranslations("solar.confirm");
  const low = draft.source === "photo" && draft.confidence[field] === "low";
  const issue = draft.issues[field];
  const evidence = draft.evidence[field];
  if (!low && !evidence) return null;
  return (
    <p className={cn("type-small", low ? "text-alert" : "text-cell-muted")}>
      {low && (
        <>
          <AlertTriangle aria-hidden className="mr-1 inline size-3.5 align-[-2px]" strokeWidth={2} />
          {issue && t.has(`issues.${issue}`) ? t(`issues.${issue}`) : t("checkThis")}{" "}
        </>
      )}
      {evidence && t("readAs", { text: evidence })}
    </p>
  );
}

export function NewReport() {
  const t = useTranslations("solar");
  const tc = useTranslations("solar.confirm");
  const tr = useTranslations("solar.roof");
  const router = useRouter();
  const { data: profile } = useProfile();

  const [stage, setStage] = useState<Stage>("choose");
  const [workStep, setWorkStep] = useState<WorkStep>("uploading");
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(profile?.discom, profile?.sanctioned_load_kw, profile?.supply));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [billId, setBillId] = useState<string | null>(null);
  const [pin, setPin] = useState<LngLat | null>(
    profile?.lat != null && profile?.lng != null ? [profile.lng, profile.lat] : null,
  );
  const [roofArea, setRoofArea] = useState(profile?.roof_area_sqft != null ? String(profile.roof_area_sqft) : "");
  const [shading, setShading] = useState<Shading>(profile?.shading ?? "none");
  const [measuring, setMeasuring] = useState(false);
  const [polygon, setPolygon] = useState<LngLat[]>([]);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const startManual = (reason: string | null) => {
    setProblem(reason);
    setDraft((d) => ({
      ...emptyDraft(profile?.discom, profile?.sanctioned_load_kw, profile?.supply),
      discom: d.discom || profile?.discom || "",
    }));
    setStage("confirm");
  };

  const useSample = async () => {
    setProblem(null);
    try {
      const res = await fetch("/sample-bill.jpg");
      const blob = await res.blob();
      await onFile(new File([blob], "sample-bill.jpg", { type: "image/jpeg" }));
    } catch {
      setProblem(t("new.uploadFailed"));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!TYPES.includes(file.type)) return setProblem(t("new.wrongType"));
    if (file.size > MAX_BYTES) return setProblem(t("new.tooLarge"));
    setStage("working");
    setWorkStep("uploading");
    let key: string;
    try {
      const p = await presignUpload("bill", file.type);
      await uploadToS3(p, file);
      key = p.key;
    } catch {
      setStage("choose");
      return setProblem(t("new.uploadFailed"));
    }
    setWorkStep("reading");
    try {
      const extraction = await extractBill(key);
      setWorkStep("checking");
      setDraft((d) => draftFromExtraction(extraction, d, key));
      setStage("confirm");
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : "";
      const reason =
        code === "rate_limited"
          ? t("new.readRateLimited")
          : code === "ai_unavailable" || code === "auth_not_configured" || code === "api_not_configured" || (err instanceof ApiFailure && err.status === 502 && code !== "extraction_failed")
            ? null // straight to the bill form, which already says what to enter
            : t("new.readFailed");
      startManual(reason);
    }
  };

  const validate = (): BillIn | null => {
    const e: Record<string, string> = {};
    const units = Number(draft.units);
    if (!(units > 0 && units <= 20000)) e.units = tc("errors.units");
    if (!draft.discom) e.discom = tc("errors.discom");
    const amount = draft.amount.trim() === "" ? null : Number(draft.amount);
    if (amount !== null && !(amount >= 0)) e.amount = tc("errors.amount");
    if (draft.discom === "other" && !(amount && amount > 0)) e.amount = tc("amountOther");
    if (draft.start && draft.end && draft.end < draft.start) e.end = tc("errors.period");
    const load = draft.load.trim() === "" ? null : Number(draft.load);
    if (load !== null && !(load > 0 && load <= 200)) e.load = tc("errors.load");
    const charges: Record<string, number> = {};
    for (const [k, v] of Object.entries(draft.charges)) {
      if (v.trim() === "") continue;
      const n = Number(v);
      if (!(n >= 0 && n <= 100)) e[`charge.${k}`] = tc("errors.charge");
      else charges[k] = n;
    }
    const history = draft.history
      .filter((h) => h.month || h.units)
      .map((h, i) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(h.month)) e[`history.${i}`] = tc("errors.month");
        return { month: h.month, units: Number(h.units) || 0 };
      });
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      discom: draft.discom,
      units_kwh: units,
      period_start: draft.start || null,
      period_end: draft.end || null,
      total_amount_inr: amount,
      sanctioned_load_kw: load,
      supply: draft.supply,
      charges,
      history,
      source: draft.source,
      s3_key: draft.s3Key,
      confidence: draft.source === "photo" ? draft.confidence : {},
    };
  };

  const onConfirm = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const bill = validate();
    if (!bill) return;
    setBusy(true);
    setProblem(null);
    try {
      const saved = await saveBill(bill);
      setBillId(saved.id);
      setStage("roof");
      window.scrollTo({ top: 0 });
    } catch {
      setProblem(tr("createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const area = Number(roofArea);
    const e: Record<string, string> = {};
    if (!pin) e.pin = tr("needPin");
    if (!(area >= 10 && area <= 200000)) e.area = tc("errors.units");
    setErrors(e);
    if (Object.keys(e).length || !billId || !pin) return;
    setBusy(true);
    setProblem(null);
    try {
      const report = await createReport(billId, { lat: pin[1], lng: pin[0], roof_area_sqft: area, shading });
      router.push(`/app/solar/${report.id}`);
    } catch (err) {
      setProblem(err instanceof ApiFailure && err.code === "irradiance_unavailable" ? tr("sunUnavailable") : tr("createFailed"));
      setBusy(false);
    }
  };

  const tariff = TARIFFS[draft.discom];
  const lowCount =
    draft.source === "photo"
      ? Object.entries(draft.confidence).filter(([, c]) => c === "low").length
      : 0;

  return (
    <div className="mx-auto max-w-2xl">
      {stage === "choose" && (
        <section>
          <h1 className="type-display text-3xl sm:text-4xl">{t("new.title")}</h1>
          <p className="mt-3 text-cell-muted">{t("new.intro")}</p>
          {problem && (
            <p role="alert" className="mt-6 rounded-input border border-alert/40 bg-alert/5 px-3 py-2.5 text-sm text-alert">
              {problem}
            </p>
          )}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button size="lg" className="h-16" onClick={() => cameraRef.current?.click()}>
              <Camera aria-hidden strokeWidth={1.75} />
              {t("new.takePhoto")}
            </Button>
            <Button size="lg" variant="secondary" className="h-16" onClick={() => fileRef.current?.click()}>
              <FileUp aria-hidden strokeWidth={1.75} />
              {t("new.chooseFile")}
            </Button>
          </div>
          <p className="mt-2 type-small text-cell-muted">{t("new.fileHint")}</p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <input ref={fileRef} type="file" accept={TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden data-testid="bill-file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div className="my-8 flex items-center gap-3 type-small text-cell-muted" aria-hidden>
            <span className="h-px flex-1 bg-concrete" />
            {t("new.or")}
            <span className="h-px flex-1 bg-concrete" />
          </div>
          <div className="flex flex-wrap gap-x-6">
            <Button variant="link" onClick={() => void useSample()} data-testid="use-sample-bill">
              {t("new.useSample")}
            </Button>
            <Button variant="link" onClick={() => startManual(null)}>
              {t("new.typeIt")}
            </Button>
          </div>
        </section>
      )}

      {stage === "working" && (
        <section aria-busy="true">
          <h1 className="type-display text-3xl sm:text-4xl">{t("new.title")}</h1>
          <div className="mt-8 rounded-panel border border-concrete bg-parapet p-6">
            <Steps current={workStep} failed={false} />
          </div>
        </section>
      )}

      {stage === "confirm" && (
        <form onSubmit={onConfirm} noValidate>
          <h1 className="type-display text-3xl sm:text-4xl">{draft.source === "photo" ? tc("title") : tc("titleManual")}</h1>
          <p className="mt-3 text-cell-muted">{draft.source === "photo" ? tc("intro") : tc("introManual")}</p>
          {problem && (
            <p role="status" className="mt-4 rounded-input border border-concrete bg-parapet px-3 py-2.5 text-sm">
              {problem}
            </p>
          )}
          {lowCount > 0 && (
            <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-alert">
              <AlertTriangle aria-hidden className="size-4" strokeWidth={2} />
              {tc("checkCount", { count: lowCount })}
            </p>
          )}
          {draft.saved && (
            <p role="status" className="mt-4 rounded-input border border-concrete bg-parapet px-3 py-2.5 text-sm">
              {tc("savedSample")}
            </p>
          )}
          {draft.name && <p className="mt-4 type-small text-cell-muted">{tc("name")}: {draft.name}</p>}

          <div className="mt-8 grid gap-6">
            <div className="grid gap-1.5">
              <Field id="discom" label={tc("discom")} error={errors.discom}>
                <select className={cn(inputClasses, draft.confidence.discom === "low" && draft.source === "photo" && "border-alert")} value={draft.discom} onChange={(e) => set("discom", e.target.value)}>
                  <option value="">—</option>
                  {Object.values(TARIFFS).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.discom}
                    </option>
                  ))}
                  <option value="other">{t("discomOther")}</option>
                </select>
              </Field>
              <CheckNote draft={draft} field="discom" />
            </div>

            <div className="grid gap-1.5">
              <Field id="units" label={tc("units")} hint={tc("unitsHint")} error={errors.units}>
                <Input inputMode="decimal" value={draft.units} onChange={(e) => set("units", e.target.value)} className={cn("max-w-48 type-number text-lg", draft.confidence.units === "low" && draft.source === "photo" && "border-alert")} />
              </Field>
              <CheckNote draft={draft} field="units" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Field id="start" label={tc("periodStart")}>
                  <Input type="date" value={draft.start} onChange={(e) => set("start", e.target.value)} />
                </Field>
                <CheckNote draft={draft} field="start" />
              </div>
              <div className="grid gap-1.5">
                <Field id="end" label={tc("periodEnd")} error={errors.end}>
                  <Input type="date" value={draft.end} onChange={(e) => set("end", e.target.value)} />
                </Field>
                <CheckNote draft={draft} field="end" />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Field id="amount" label={tc("amount")} hint={draft.discom === "other" ? tc("amountOther") : tc("amountHint")} error={errors.amount}>
                <Input inputMode="decimal" value={draft.amount} onChange={(e) => set("amount", e.target.value)} className={cn("max-w-48", draft.confidence.amount === "low" && draft.source === "photo" && "border-alert")} />
              </Field>
              <CheckNote draft={draft} field="amount" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Field id="load" label={tc("load")} error={errors.load}>
                  <Input inputMode="decimal" value={draft.load} onChange={(e) => set("load", e.target.value)} />
                </Field>
                <CheckNote draft={draft} field="load" />
              </div>
              <Field id="supply" label={tc("supply")}>
                <select className={inputClasses} value={draft.supply} onChange={(e) => set("supply", e.target.value as "single" | "three")}>
                  <option value="single">{t("supplySingle")}</option>
                  <option value="three">{t("supplyThree")}</option>
                </select>
              </Field>
            </div>

            {tariff && (tariff.bill_inputs ?? []).length > 0 && (
              <fieldset className="grid gap-4">
                <legend className="type-ui text-sm">{tc("fromBill")}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(tariff.bill_inputs ?? []).map((b) => (
                    <Field key={b.id} id={`charge-${b.id}`} label={`${b.label} (${b.kind === "pct" ? tc("percent") : tc("perUnit")})`} hint={tc("chargeHint")} error={errors[`charge.${b.id}`]}>
                      <Input inputMode="decimal" value={draft.charges[b.id] ?? ""} onChange={(e) => set("charges", { ...draft.charges, [b.id]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              </fieldset>
            )}

            <fieldset>
              <legend className="type-ui text-sm">{tc("history")}</legend>
              <p className="type-small text-cell-muted">{tc("historyHint")}</p>
              {draft.history.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {draft.history.map((h, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Field id={`hm-${i}`} label={tc("historyMonth")} className="flex-1 [&_label]:sr-only" error={errors[`history.${i}`]}>
                        <Input type="month" value={h.month} onChange={(e) => set("history", draft.history.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} />
                      </Field>
                      <Field id={`hu-${i}`} label={tc("historyUnits")} className="w-32 [&_label]:sr-only">
                        <Input inputMode="decimal" value={h.units} onChange={(e) => set("history", draft.history.map((x, j) => (j === i ? { ...x, units: e.target.value } : x)))} />
                      </Field>
                      <Button type="button" variant="ghost" size="icon" aria-label={tc("removeMonth", { month: h.month || i + 1 })} onClick={() => set("history", draft.history.filter((_, j) => j !== i))}>
                        <Minus aria-hidden strokeWidth={1.75} />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => set("history", [...draft.history, { month: "", units: "" }])} disabled={draft.history.length >= 24}>
                <Plus aria-hidden strokeWidth={1.75} />
                {tc("addMonth")}
              </Button>
            </fieldset>
          </div>
          <div className="mt-10 border-t border-concrete pt-6">
            <Button type="submit" size="lg" disabled={busy}>
              {tc("submit")}
            </Button>
          </div>
        </form>
      )}

      {stage === "roof" && (
        <form onSubmit={onCreate} noValidate>
          <h1 className="type-display text-3xl sm:text-4xl">{tr("title")}</h1>
          <p className="mt-3 text-cell-muted">{tr("intro")}</p>
          <div className="mt-8 grid gap-6">
            <div>
              <RoofMap
                pin={pin}
                onPinChange={setPin}
                measuring={measuring}
                polygon={polygon}
                onPolygonChange={setPolygon}
                onPolygonClose={() => {
                  setMeasuring(false);
                  if (polygon.length >= 3) setRoofArea(String(Math.round(sqmToSqft(polygonAreaSqm(polygon)))));
                }}
                label={tr("title")}
              />
              {errors.pin && <p role="alert" className="mt-2 text-sm text-alert">{errors.pin}</p>}
            </div>
            <div className="grid gap-2">
              <Field id="area" label={tr("area")} hint={tr("areaHint")} error={errors.area}>
                <Input inputMode="decimal" value={roofArea} onChange={(e) => setRoofArea(e.target.value)} className="max-w-48" />
              </Field>
              <div className="flex gap-2">
                {!measuring ? (
                  <Button type="button" variant="secondary" size="sm" disabled={!pin} onClick={() => { setPolygon([]); setMeasuring(true); }}>
                    {t("measure")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" disabled={polygon.length < 3} onClick={() => { setMeasuring(false); setRoofArea(String(Math.round(sqmToSqft(polygonAreaSqm(polygon))))); }}>
                    {t("measureDone")}
                  </Button>
                )}
              </div>
            </div>
            <fieldset>
              <legend className="type-ui text-sm">{tr("shading")}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(["none", "partial", "heavy"] as const).map((v) => (
                  <label key={v} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-button border px-3 py-2.5 text-sm", shading === v ? "border-cell bg-parapet" : "border-field bg-parapet/60 hover:border-cell")}>
                    <input type="radio" name="shading" value={v} checked={shading === v} onChange={() => setShading(v)} className="size-4 accent-[var(--cell)]" />
                    {tr(v === "none" ? "shadingNone" : v === "partial" ? "shadingPartial" : "shadingHeavy")}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          {problem && (
            <p role="alert" className="mt-6 text-sm text-alert">
              {problem}
            </p>
          )}
          <div className="mt-10 border-t border-concrete pt-6">
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? tr("creating") : tr("submit")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
