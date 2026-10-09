"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, Plus, Trash2, Truck } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Sack } from "@/components/brand/resource-kit";
import { PageHeader } from "@/components/features/app/app-shell";
import { useProfile } from "@/components/features/app/use-profile";
import { HowCalculated } from "@/components/features/working/how-calculated";
import { ResourceTag } from "@/components/ui/blocks";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Readout } from "@/components/ui/readout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/primitives";
import {
  ApiFailure,
  classifyWaste,
  deleteWasteScan,
  getPartners,
  getWaste,
  presignUpload,
  requestPickup,
  saveWasteScan,
  type Stream,
  uploadToS3,
  type WasteScan,
} from "@/lib/api";
import WASTE from "@/lib/calc/data/waste.json";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Size = "handful" | "bag" | "sack";
type MaterialId = keyof typeof MATERIALS;
const MATERIALS = Object.fromEntries(WASTE.materials.map((m) => [m.id, m])) as Record<string, (typeof WASTE.materials)[number]>;
const STREAM_ORDER: Stream[] = ["wet", "dry", "sanitary", "special_care", "e_waste"];
const SIZES: Size[] = ["handful", "bag", "sack"];

interface Draft {
  key: number;
  material: string;
  label: string;
  size: Size | null;
  kg: string;
  tip?: string;
  unsure?: boolean;
}

const inrRange = (min: number, max: number, lang: string) =>
  min === max ? formatInr(min, lang) : `${formatInr(min, lang)}–${formatInr(max, lang)}`;

let nextKey = 1;
const blank = (): Draft => ({ key: nextKey++, material: "newspaper", label: "", size: "bag", kg: "" });

function ItemRow({ item, onChange, onRemove, canRemove }: { item: Draft; onChange: (d: Draft) => void; onRemove: () => void; canRemove: boolean }) {
  const t = useTranslations("waste");
  const m = MATERIALS[item.material as MaterialId];
  const id = `item-${item.key}`;
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-12 sm:items-start">
      {item.label && <p className="type-heading text-base sm:col-span-12">{item.label}</p>}
      <div className="sm:col-span-5">
        <Label htmlFor={`${id}-material`} className="type-ui text-sm">
          {t("material")}
        </Label>
        <Select value={item.material} onValueChange={(v) => onChange({ ...item, material: v, label: "", tip: undefined, unsure: false })}>
          <SelectTrigger id={`${id}-material`} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WASTE.materials.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {t(`materials.${x.id}` as "materials.pet")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 type-small text-cell-muted">
          <span className="rounded-[4px] border border-concrete px-1.5">{t(`streams.${m.stream as Stream}`)}</span>
          {m.rate_inr_per_kg?.max ? null : <span>{t("notBought")}</span>}
        </p>
        {item.unsure && (
          <p className="mt-1.5 flex items-center gap-1.5 type-small text-alert">
            <AlertTriangle aria-hidden className="size-3.5" strokeWidth={2} />
            {t("checkThis")}
          </p>
        )}
      </div>
      <fieldset className="sm:col-span-6">
        <legend className="type-ui text-sm">{t("weight")}</legend>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={item.size === s && !item.kg}
              onClick={() => onChange({ ...item, size: s, kg: "" })}
              className={cn(
                "min-h-11 cursor-pointer rounded-button border px-3 text-sm",
                item.size === s && !item.kg ? "border-cell bg-limewash" : "border-field bg-parapet hover:border-cell",
              )}
            >
              {t(`sizes.${s}`)}
            </button>
          ))}
          <span className="type-small text-cell-muted">{t("or")}</span>
          <Input
            aria-label={t("weight")}
            inputMode="decimal"
            placeholder="kg"
            value={item.kg}
            onChange={(e) => onChange({ ...item, kg: e.target.value, size: e.target.value ? null : item.size })}
            className="w-24 type-number"
          />
        </div>
        <p className="mt-1.5 type-small text-cell-muted">{item.tip ?? t(`notes.${item.material}` as "notes.pet")}</p>
      </fieldset>
      <div className="sm:col-span-1 sm:pt-7 sm:text-right">
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" aria-label={t("remove")} onClick={onRemove}>
            <Trash2 aria-hidden strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </li>
  );
}

function Pickup({ scan, city }: { scan: WasteScan; city?: string | null }) {
  const t = useTranslations("waste.pickup");
  const partners = useQuery({ queryKey: ["partners", city ?? ""], queryFn: () => getPartners(city) });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [partnerId, setPartnerId] = useState<string>("");
  const [date, setDate] = useState(tomorrow);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => requestPickup(partnerId, scan.id, date, note.trim() || undefined),
    onSuccess: (r) =>
      setDone(r.emailed ? t("sentEmailed", { name: r.partner.name, phone: r.partner.phone }) : t("sent", { name: r.partner.name, phone: r.partner.phone })),
  });
  const list = partners.data ?? [];
  const chosen = list.find((p) => p.id === partnerId);
  if (done)
    return (
      <p role="status" className="mt-4 rounded-input border border-leaf/40 px-4 py-3 text-sm">
        {done}
      </p>
    );
  return (
    <form
      aria-labelledby="pickup-title"
      className="mt-5 border-t border-concrete pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (partnerId) send.mutate();
      }}
    >
      <h3 id="pickup-title" className="type-heading text-lg">
        {t("title")}
      </h3>
      {partners.isPending ? (
        <Skeleton className="mt-3 h-11" />
      ) : list.length === 0 ? (
        <p className="mt-2 text-sm text-cell-muted">{t("none")}</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="pickup-partner" className="type-ui text-sm">
              {t("partner")}
            </Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger id="pickup-partner" className="mt-1.5">
                <SelectValue placeholder={t("partner")} />
              </SelectTrigger>
              <SelectContent>
                {list.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}, {p.area}
                    {p.is_demo ? ` (${t("demo")})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {chosen?.is_demo && <p className="mt-1.5 type-small text-cell-muted">{t("demoNote")}</p>}
          </div>
          <Field id="pickup-date" label={t("date")}>
            <Input type="date" value={date} min={tomorrow} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="pickup-note" label={t("note")}>
            <Textarea value={note} maxLength={300} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {send.isError && (
            <p role="alert" className="text-sm text-alert sm:col-span-2">
              {t("error")}
            </p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={!partnerId || send.isPending}>
              <Truck aria-hidden strokeWidth={1.75} />
              {t("send")}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

function ScanResult({ scan, city }: { scan: WasteScan; city?: string | null }) {
  const t = useTranslations("waste.result");
  const lang = useLocale();
  const format = useFormatter();
  const [pickup, setPickup] = useState(false);
  const sellable = scan.inr_max > 0;
  return (
    <div role="status" className="mt-6 rounded-panel border border-kraft/50 bg-parapet p-5">
      <p className="type-heading text-lg">{t("title")}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Readout
          label={t("diverted")}
          value={
            <>
              {formatNumber(scan.kg_diverted, lang, 1)}
              <span className="ml-1.5 type-small font-normal text-cell-muted">kg</span>
            </>
          }
        />
        <Readout label={t("value")} value={sellable ? inrRange(scan.inr_min, scan.inr_max, lang) : "—"} />
        <Readout
          label={t("co2")}
          value={
            <>
              {formatNumber(scan.co2_t * 1000, lang, 1)}
              <span className="ml-1.5 type-small font-normal text-cell-muted">kg</span>
            </>
          }
        />
      </div>
      <p className="mt-3 max-w-[70ch] type-small text-cell-muted">
        {t("valueNote", { date: format.dateTime(new Date(WASTE.rates_as_of), { dateStyle: "medium" }) })}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <HowCalculated steps={scan.working} title={t("title")} />
        {sellable && !pickup && (
          <Button size="sm" variant="secondary" onClick={() => setPickup(true)}>
            <Truck aria-hidden strokeWidth={1.75} />
            {t("pickup")}
          </Button>
        )}
      </div>
      {pickup && <Pickup scan={scan} city={city} />}
    </div>
  );
}

function SortPile({ city }: { city?: string | null }) {
  const t = useTranslations("waste");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [photoKey, setPhotoKey] = useState<string | undefined>();
  const [note, setNote] = useState<{ text: string; alert?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<WasteScan | null>(null);
  const [reading, setReading] = useState(false);

  const onPhoto = async (file?: File) => {
    if (!file) return;
    setSaved(null);
    setReading(true);
    setNote({ text: t("reading") });
    try {
      const p = await presignUpload("waste", file.type);
      await uploadToS3(p, file);
      const r = await classifyWaste(p.key);
      if (r.items.length === 0) throw new Error("empty");
      setPhotoKey(p.key);
      setItems(
        r.items.map((i) => ({
          key: nextKey++,
          material: i.material,
          label: i.label,
          size: "bag",
          kg: "",
          tip: i.tip,
          unsure: i.confidence === "low",
        })),
      );
      setNote(null);
    } catch (err) {
      const off = err instanceof ApiFailure && err.code === "ai_unavailable";
      setNote({ text: off ? t("readUnavailable") : t("readFailed"), alert: !off });
      setItems((cur) => (cur.length ? cur : [blank()]));
    } finally {
      setReading(false);
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const body = items.map((i) => {
        const kg = Number(i.kg);
        if (i.kg.trim() && (!Number.isFinite(kg) || kg <= 0 || kg > 1000)) throw new Error("kg");
        if (!i.kg.trim() && !i.size) throw new Error("kg");
        return { material: i.material, label: i.label || undefined, ...(i.kg.trim() ? { kg } : { size: i.size! }) };
      });
      return saveWasteScan(body, photoKey);
    },
    onSuccess: async (scan) => {
      setSaved(scan);
      setItems([]);
      setPhotoKey(undefined);
      setError(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["waste"] }), qc.invalidateQueries({ queryKey: ["home"] })]);
    },
    onError: () => setError(t("saveError")),
  });

  const p = WASTE.size_presets_kg;
  return (
    <section aria-labelledby="sort-pile" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="sort-pile" className="type-heading text-xl">
        {t("scanTitle")}
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm text-cell-muted">{t("scanIntro")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" onClick={() => fileRef.current?.click()} disabled={reading}>
          <Camera aria-hidden strokeWidth={1.75} />
          {t("takePhoto")}
        </Button>
        {items.length === 0 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSaved(null);
              setItems([blank()]);
            }}
          >
            {t("addByHand")}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="waste-file"
          onChange={(e) => {
            void onPhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {note && (
        <p role="status" className={cn("mt-3 text-sm", note.alert ? "text-alert" : "text-cell-muted")}>
          {note.text}
        </p>
      )}

      {items.length > 0 && (
        <form
          aria-labelledby="items-title"
          className="mt-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h3 id="items-title" className="type-heading text-lg">
            {t("itemsTitle")}
          </h3>
          <p className="mt-1 type-small text-cell-muted">
            {t("itemsIntro")} {t("sizeHint", { handful: p.handful, bag: p.bag, sack: p.sack })}
          </p>
          <ul className="mt-2 divide-y divide-concrete border-y border-concrete">
            {items.map((it, i) => (
              <ItemRow
                key={it.key}
                item={it}
                canRemove={items.length > 1}
                onChange={(d) => setItems((cur) => cur.map((x, j) => (j === i ? d : x)))}
                onRemove={() => setItems((cur) => cur.filter((_, j) => j !== i))}
              />
            ))}
          </ul>
          {error && (
            <p role="alert" className="mt-3 text-sm text-alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t("saving") : t("save")}
            </Button>
            {items.length < 20 && (
              <Button type="button" variant="secondary" onClick={() => setItems((cur) => [...cur, blank()])}>
                <Plus aria-hidden strokeWidth={1.75} />
                {t("addItem")}
              </Button>
            )}
          </div>
        </form>
      )}

      {saved && <ScanResult scan={saved} city={city} />}
    </section>
  );
}

function History({ scans }: { scans: WasteScan[] }) {
  const t = useTranslations("waste");
  const lang = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: deleteWasteScan,
    onSuccess: async () => {
      toast(t("deleted"));
      await Promise.all([qc.invalidateQueries({ queryKey: ["waste"] }), qc.invalidateQueries({ queryKey: ["home"] })]);
    },
  });
  if (scans.length === 0) return null;
  return (
    <section aria-labelledby="waste-history">
      <h2 id="waste-history" className="type-heading text-xl">
        {t("historyTitle")}
      </h2>
      <ul className="mt-3 divide-y divide-concrete border-y border-concrete">
        {scans.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
            <div className="min-w-0">
              <p className="text-sm">
                {format.dateTime(new Date(s.at), { dateStyle: "medium" })}
                <span className="ml-3 type-number">{formatNumber(s.kg_total, lang, 1)} kg</span>
                {s.inr_max > 0 && (
                  <span className="ml-3 text-cell-muted">
                    {t("worth", { value: inrRange(s.inr_min, s.inr_max, lang) })}
                  </span>
                )}
              </p>
              <p className="truncate type-small text-cell-muted">{s.items.map((i) => i.label).join(", ")}</p>
            </div>
            <div className="flex items-center gap-3">
              <HowCalculated steps={s.working} />
              <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => del.mutate(s.id)}>
                {t("delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WastePage() {
  const t = useTranslations("waste");
  const lang = useLocale();
  const { data: profile } = useProfile();
  const q = useQuery({ queryKey: ["waste"], queryFn: getWaste });
  if (q.isPending || !profile) return <Skeleton className="mx-auto h-96 max-w-[1200px]" />;
  if (q.isError) return <p role="alert" className="text-alert">{t("loadError")}</p>;
  const { week, scans } = q.data;
  // The sack shows the share of this week's waste that was kept out of landfill.
  const divertedPct = week.kg_total > 0 ? Math.round((week.kg_diverted / week.kg_total) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader title={t("title")}>
        <ResourceTag resource="waste">{t("title")}</ResourceTag>
      </PageHeader>

      <section aria-labelledby="waste-week" className="grid gap-6 lg:grid-cols-12">
        <div className="flex items-center justify-center rounded-panel border border-concrete bg-parapet p-5 lg:col-span-4">
          <Sack fillPct={divertedPct} title={t("coach.diverted", { pct: divertedPct })} className="h-44 w-auto" />
        </div>
        <div className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6 lg:col-span-8">
          <h2 id="waste-week" className="type-heading text-xl">
            {t("coach.title")}
          </h2>
          {week.kg_total > 0 ? (
            <>
              <p className="mt-1 type-number text-2xl">{t("coach.total", { kg: formatNumber(week.kg_total, lang, 1) })}</p>
              <p className="text-sm text-cell-muted">{t("coach.diverted", { pct: divertedPct })}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
                {STREAM_ORDER.filter((s) => week.kg_by_stream[s]).map((s) => (
                  <div key={s} className="border-t-2 border-kraft pt-1.5">
                    <dt className="type-small text-cell-muted">{t(`streams.${s}`)}</dt>
                    <dd className="type-number">{formatNumber(week.kg_by_stream[s]!, lang, 1)} kg</dd>
                  </div>
                ))}
              </dl>
              {week.tip && <p className="mt-4 max-w-[60ch] text-sm">{t(`coach.tips.${week.tip}`)}</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-cell-muted">{t("coach.empty")}</p>
          )}
        </div>
      </section>

      <SortPile city={profile.city} />

      <History scans={scans} />
    </div>
  );
}
