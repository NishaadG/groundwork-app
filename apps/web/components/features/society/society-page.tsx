"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FileText, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Tank } from "@/components/brand/resource-kit";
import { PageHeader } from "@/components/features/app/app-shell";
import { useProfile } from "@/components/features/app/use-profile";
import { HowCalculated } from "@/components/features/working/how-calculated";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClasses, Label, Textarea } from "@/components/ui/field";
import { Skeleton, Switch } from "@/components/ui/primitives";
import { Readout } from "@/components/ui/readout";
import { Link } from "@/i18n/navigation";
import {
  ApiFailure,
  createSociety,
  type CommonSolarIn,
  deleteAnnouncement,
  estimateCommonSolar,
  getSociety,
  joinSociety,
  leaveSociety,
  logSocietyTank,
  type MemberFields,
  postAnnouncement,
  type Society,
  updateMembership,
} from "@/lib/api";
import { TARIFFS } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const KEY = ["society"];
type Metric = "inr" | "kwh" | "litres" | "kg" | "co2_t";
const METRICS: Metric[] = ["inr", "kwh", "litres", "kg", "co2_t"];

function useSetSociety() {
  const qc = useQueryClient();
  return (s: Society | null) => qc.setQueryData(KEY, s);
}

function formatMetric(m: Metric, v: number, lang: string) {
  if (m === "inr") return formatInr(v, lang);
  if (m === "co2_t") return `${formatNumber(v, lang, 2)} t`;
  if (m === "kwh") return `${formatNumber(v, lang)} kWh`;
  if (m === "litres") return `${formatNumber(v, lang)} L`;
  return `${formatNumber(v, lang, 1)} kg`;
}

/** The member's own leaderboard fields, shared by the create and join forms. */
function MemberInputs({ prefix, value, onChange }: { prefix: string; value: MemberFields; onChange: (v: MemberFields) => void }) {
  const t = useTranslations("societyPage.you");
  return (
    <>
      <Field id={`${prefix}-flat`} label={t("flat")} hint={t("flatHint")}>
        <Input value={value.flat_label ?? ""} maxLength={20} onChange={(e) => onChange({ ...value, flat_label: e.target.value })} />
      </Field>
      <Field id={`${prefix}-nick`} label={t("nickname")} hint={t("nicknameHint")}>
        <Input value={value.nickname ?? ""} maxLength={30} onChange={(e) => onChange({ ...value, nickname: e.target.value })} />
      </Field>
      <div className="flex items-start gap-3 sm:col-span-2">
        <Switch id={`${prefix}-opt`} checked={Boolean(value.leaderboard_opt_in)} onCheckedChange={(c) => onChange({ ...value, leaderboard_opt_in: c })} aria-describedby={`${prefix}-opt-hint`} />
        <div>
          <Label htmlFor={`${prefix}-opt`}>{t("optIn")}</Label>
          <p id={`${prefix}-opt-hint`} className="type-small text-cell-muted">
            {t("optInHint")}
          </p>
        </div>
      </div>
    </>
  );
}

function errorText(err: unknown, t: (k: "errors.generic" | "errors.already" | "join.notFound") => string) {
  if (err instanceof ApiFailure && err.code === "already_in_society") return t("errors.already");
  if (err instanceof ApiFailure && err.code === "invite_not_found") return t("join.notFound");
  return t("errors.generic");
}

function CreateForm() {
  const t = useTranslations("societyPage");
  const { data: profile } = useProfile();
  const set = useSetSociety();
  const [member, setMember] = useState<MemberFields>({ leaderboard_opt_in: false });
  const schema = z.object({
    name: z.string().trim().min(2, t("errors.name")).max(80),
    city: z.string().trim().min(2, t("errors.city")).max(60),
    flats: z.coerce.number({ error: t("errors.flats") }).int(t("errors.flats")).min(2, t("errors.flats")).max(5000, t("errors.flats")),
  });
  type In = z.input<typeof schema>;
  const form = useForm<In, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", city: profile?.city ?? "", flats: "" },
  });
  const create = useMutation({ mutationFn: createSociety, onSuccess: set });
  const e = form.formState.errors;
  return (
    <section aria-labelledby="create-society" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="create-society" className="type-heading text-xl">
        {t("create.title")}
      </h2>
      <p className="mt-1 text-sm text-cell-muted">{t("create.body")}</p>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" noValidate onSubmit={form.handleSubmit((v) => create.mutate({ ...v, ...member }))}>
        <Field id="soc-name" label={t("create.name")} error={e.name?.message} className="sm:col-span-2">
          <Input {...form.register("name")} />
        </Field>
        <Field id="soc-city" label={t("create.city")} error={e.city?.message}>
          <Input autoComplete="address-level2" {...form.register("city")} />
        </Field>
        <Field id="soc-flats" label={t("create.flats")} error={e.flats?.message}>
          <Input inputMode="numeric" {...form.register("flats")} />
        </Field>
        <MemberInputs prefix="create" value={member} onChange={setMember} />
        {create.isError && (
          <p role="alert" className="text-sm text-alert sm:col-span-2">
            {errorText(create.error, t)}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            {t("create.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function JoinForm({ initialCode }: { initialCode: string }) {
  const t = useTranslations("societyPage");
  const set = useSetSociety();
  const [code, setCode] = useState(initialCode);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [member, setMember] = useState<MemberFields>({ leaderboard_opt_in: false });
  const join = useMutation({ mutationFn: joinSociety, onSuccess: set });
  return (
    <section aria-labelledby="join-society" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="join-society" className="type-heading text-xl">
        {t("join.title")}
      </h2>
      <p className="mt-1 text-sm text-cell-muted">{t("join.body")}</p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          const clean = code.replace(/[\s-]/g, "").toUpperCase();
          if (clean.length !== 8) return setCodeError(t("errors.code"));
          setCodeError(undefined);
          join.mutate({ code: clean, ...member });
        }}
      >
        <Field id="join-code" label={t("join.code")} error={codeError} className="sm:col-span-2">
          <Input value={code} autoCapitalize="characters" autoComplete="off" spellCheck={false} className="type-number uppercase tracking-[0.15em]" onChange={(ev) => setCode(ev.target.value)} />
        </Field>
        <MemberInputs prefix="join" value={member} onChange={setMember} />
        {join.isError && (
          <p role="alert" className="text-sm text-alert sm:col-span-2">
            {errorText(join.error, t)}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={join.isPending}>
            {t("join.submit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Invite({ s }: { s: Society }) {
  const t = useTranslations("societyPage.invite");
  const link = typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}?code=${s.invite_code}`;
  return (
    <section aria-labelledby="invite" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="invite" className="type-heading text-xl">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-cell-muted">{t("body")}</p>
      <p className="mt-4 type-number text-3xl tracking-[0.15em]" aria-label={s.invite_code.split("").join(" ")}>
        {s.invite_code.slice(0, 4)}-{s.invite_code.slice(4)}
      </p>
      <Button size="sm" variant="secondary" className="mt-3" onClick={() => navigator.clipboard.writeText(link).then(() => toast(t("copied")))}>
        <Copy aria-hidden strokeWidth={1.75} />
        {t("copy")}
      </Button>
    </section>
  );
}

function Stats({ s }: { s: Society }) {
  const t = useTranslations("societyPage.stats");
  const lang = useLocale();
  const realised = METRICS.filter((m) => s.totals.realised[m]);
  const projected = METRICS.filter((m) => s.totals.projected[m]);
  const part = s.working.find((w) => w.id === "society_participation");
  return (
    <section aria-label={t("realised")} className="space-y-4">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-panel border border-concrete bg-concrete sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-parapet p-5">
          <Readout
            label={t("households")}
            value={
              <>
                {formatNumber(s.members, lang)}
                <span className="ml-1.5 type-small font-normal text-cell-muted">{t("householdsOf", { flats: formatNumber(s.flats, lang) })}</span>
              </>
            }
          />
          <p className="mt-2 type-small text-cell-muted">{t("participation", { pct: formatNumber(s.participation_pct, lang, 1) })}</p>
          {part && (
            <div className="mt-1">
              <HowCalculated steps={[part]} />
            </div>
          )}
        </div>
        <div className="bg-parapet p-5">
          <Readout label={t("leaks")} value={formatNumber(s.leaks.found, lang)} />
          <p className="mt-2 type-small text-cell-muted">{t("leaksFixed", { count: s.leaks.fixed })}</p>
        </div>
        {realised.map((m) => (
          <div key={m} className="bg-parapet p-5">
            <Readout label={t(m)} value={formatMetric(m, s.totals.realised[m]!, lang)} tone="leaf" />
            <p className="mt-2 type-small text-cell-muted">{t("realised")}</p>
            <div className="mt-1">
              <HowCalculated steps={s.working.filter((w) => w.id === `society_${m}`)} />
            </div>
          </div>
        ))}
        {realised.length === 0 ? (
          <div className="bg-parapet p-5 sm:col-span-2 lg:col-span-1">
            <p className="text-sm text-cell-muted">{t("none")}</p>
          </div>
        ) : (
          <>
            {/* Fill the last row so the grid's hairline background never shows as a block */}
            {Array.from({ length: (3 - ((2 + realised.length) % 3)) % 3 }, (_, i) => (
              <div key={`lg${i}`} aria-hidden className="hidden bg-parapet lg:block" />
            ))}
            {(2 + realised.length) % 2 === 1 && <div aria-hidden className="hidden bg-parapet sm:block lg:hidden" />}
          </>
        )}
      </div>
      {projected.length > 0 && (
        <p className="text-sm text-cell-muted">
          {t("projected")}: {projected.map((m) => `${t(m)} ${formatMetric(m, s.totals.projected[m]!, lang)}`).join(" · ")}
        </p>
      )}
      {s.members <= 3 && <p className="type-small text-cell-muted">{t("smallNote")}</p>}
    </section>
  );
}

function Leaderboard({ s }: { s: Society }) {
  const t = useTranslations("societyPage.board");
  const lang = useLocale();
  return (
    <section aria-labelledby="leaderboard" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="leaderboard" className="type-heading text-xl">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-cell-muted">{t("body")}</p>
      {s.leaderboard.length === 0 ? (
        <p className="mt-4 text-sm">{t("empty")}</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-concrete text-left type-small text-cell-muted">
              <th scope="col" className="w-14 py-2 font-normal">{t("rank")}</th>
              <th scope="col" className="py-2 font-normal">{t("household")}</th>
              <th scope="col" className="py-2 text-right font-normal">{t("change")}</th>
            </tr>
          </thead>
          <tbody>
            {s.leaderboard.map((r, i) => (
              <tr key={`${r.name}-${i}`} className={cn("border-b border-dashed border-concrete", r.is_you && "bg-limewash")}>
                <td className="py-2 type-number">{r.change_pct === null ? "—" : i + 1}</td>
                <th scope="row" className="py-2 text-left font-normal">
                  {r.name}
                  {r.is_you && <span className="ml-2 type-small text-cell-muted">({t("you")})</span>}
                </th>
                <td className={cn("py-2 text-right type-number", r.change_pct !== null && r.change_pct < 0 && "text-leaf")}>
                  {r.change_pct === null ? <span className="text-cell-muted">{t("noBaseline")}</span> : `${r.change_pct > 0 ? "+" : ""}${formatNumber(r.change_pct, lang, 1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.leaderboard_hidden > 0 && <p className="mt-3 type-small text-cell-muted">{t("hidden", { count: s.leaderboard_hidden })}</p>}
    </section>
  );
}

function You({ s }: { s: Society }) {
  const t = useTranslations("societyPage.you");
  const set = useSetSociety();
  const [member, setMember] = useState<MemberFields>(s.me);
  const save = useMutation({
    mutationFn: () => updateMembership(member),
    onSuccess: (d) => {
      set(d);
      toast(t("saved"));
    },
  });
  return (
    <section aria-labelledby="you" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="you" className="type-heading text-xl">
        {t("title")}
      </h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <MemberInputs prefix="me" value={member} onChange={setMember} />
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Announcements({ s }: { s: Society }) {
  const t = useTranslations("societyPage.ann");
  const format = useFormatter();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const post = useMutation({
    mutationFn: () => postAnnouncement(text.trim()),
    onSuccess: async () => {
      setText("");
      await refresh();
    },
  });
  const del = useMutation({ mutationFn: deleteAnnouncement, onSuccess: refresh });
  return (
    <section aria-labelledby="announcements" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="announcements" className="type-heading text-xl">
        {t("title")}
      </h2>
      {s.announcements.length === 0 ? (
        <p className="mt-3 text-sm text-cell-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-concrete border-y border-concrete">
          {s.announcements.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm whitespace-pre-line">{a.text}</p>
                <p className="mt-1 type-small text-cell-muted">{format.dateTime(new Date(a.at), { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              {s.is_admin && (
                <Button size="icon" variant="ghost" aria-label={t("delete")} disabled={del.isPending} onClick={() => del.mutate(a.id)}>
                  <Trash2 aria-hidden strokeWidth={1.75} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.is_admin && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) post.mutate();
          }}
        >
          <Label htmlFor="ann-text" className="sr-only">
            {t("placeholder")}
          </Label>
          <Textarea id="ann-text" rows={2} maxLength={500} placeholder={t("placeholder")} value={text} onChange={(e) => setText(e.target.value)} />
          <div>
            <Button type="submit" size="sm" disabled={!text.trim() || post.isPending}>
              {t("post")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Tanks({ s }: { s: Society }) {
  const t = useTranslations("societyPage.tanks");
  const lang = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const [name, setName] = useState(s.tanks[0]?.name ?? "");
  const [level, setLevel] = useState("");
  const [error, setError] = useState<string | undefined>();
  const log = useMutation({
    mutationFn: () => {
      const n = Number(level);
      if (level.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) throw new Error("level");
      return logSocietyTank(name.trim(), n);
    },
    onSuccess: async () => {
      setLevel("");
      setError(undefined);
      await qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => setError(t("levelError")),
  });
  if (!s.is_admin && s.tanks.length === 0) return null;
  return (
    <section aria-labelledby="tanks" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="tanks" className="type-heading text-xl">
        {t("title")}
      </h2>
      {s.tanks.length === 0 ? (
        <p className="mt-3 text-sm text-cell-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-6">
          {s.tanks.map((k) => (
            <li key={k.name} className="flex items-center gap-3">
              <Tank fillPct={k.level_pct} title={`${k.name}: ${formatNumber(k.level_pct, lang)}%`} className="h-20 w-auto" />
              <div>
                <p className="type-ui text-sm">{k.name}</p>
                <p className="type-number text-2xl">{formatNumber(k.level_pct, lang)}%</p>
                <p className="type-small text-cell-muted">{t("updated", { time: format.dateTime(new Date(k.at), { dateStyle: "medium", timeStyle: "short" }) })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {s.is_admin && (
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) log.mutate();
          }}
        >
          <Field id="tank-name" label={t("name")}>
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="w-40" />
          </Field>
          <Field id="tank-level" label={t("level")} error={error}>
            <Input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} className="w-28 type-number" />
          </Field>
          <Button type="submit" variant="secondary" disabled={!name.trim() || log.isPending}>
            {t("log")}
          </Button>
        </form>
      )}
    </section>
  );
}

function CommonSolar({ s }: { s: Society }) {
  const t = useTranslations("societyPage.solar");
  const lang = useLocale();
  const set = useSetSociety();
  const c = s.common_solar;
  const [editing, setEditing] = useState(!c);
  const num = (min: number, max: number, msg: string) => z.coerce.number({ error: msg }).min(min, msg).max(max, msg);
  const optional = (max: number, msg: string) =>
    z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.coerce.number({ error: msg }).min(0, msg).max(max, msg).optional(),
    );
  const schema = z.object({
    discom: z.string().min(1, t("errors.discom")),
    supply: z.enum(["single", "three"]),
    sanctioned_load_kw: num(0.1, 1000, t("errors.load")),
    monthly_units: num(1, 500_000, t("errors.units")),
    terrace_area_sqft: num(10, 1_000_000, t("errors.terrace")),
    shading: z.enum(["none", "partial", "heavy"]),
    kw_already_subsidised: optional(500, t("errors.already")),
    cost_inr: optional(1_000_000_000, t("errors.cost")),
  });
  type In = z.input<typeof schema>;
  const prev = c?.inputs;
  const form = useForm<In, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      discom: prev?.discom ?? "",
      supply: prev?.supply ?? "three",
      sanctioned_load_kw: prev?.sanctioned_load_kw ?? "",
      monthly_units: prev?.monthly_units ?? "",
      terrace_area_sqft: prev?.terrace_area_sqft ?? "",
      shading: prev?.shading ?? "none",
      kw_already_subsidised: prev?.kw_already_subsidised || "",
      cost_inr: prev?.cost_inr ?? "",
    },
  });
  const run = useMutation({
    mutationFn: (v: CommonSolarIn) => estimateCommonSolar(v),
    onSuccess: (next) => {
      set(next);
      setEditing(false);
    },
  });
  if (!s.is_admin && !c) return null;
  const e = form.formState.errors;
  const r = c?.result;
  const failure =
    run.error instanceof ApiFailure && run.error.code === "location_needed" ? (
      <>
        {t("errors.location")}{" "}
        <Link href="/app/settings" className="underline underline-offset-4">
          {t("errors.locationLink")}
        </Link>
      </>
    ) : run.isError ? (
      t("errors.generic")
    ) : null;
  return (
    <section aria-labelledby="common-solar" className="rounded-panel border border-concrete bg-parapet p-5 sm:p-6">
      <h2 id="common-solar" className="type-heading text-xl">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-cell-muted">{t("intro")}</p>
      {r && !r.feasible && <p className="mt-4 text-sm">{t("notFeasible")}</p>}
      {c && r?.feasible && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-concrete bg-concrete">
            <div className="bg-parapet p-4">
              <Readout label={t("size")} value={`${formatNumber(r.size_kw, lang, Number.isInteger(r.size_kw) ? 0 : 1)} kW`} />
            </div>
            <div className="bg-parapet p-4">
              <Readout label={t("savings")} value={formatInr(r.savings_year1_inr, lang)} tone="leaf" />
            </div>
            <div className="bg-parapet p-4">
              <Readout label={t("netCost")} value={formatInr(r.net_cost_inr, lang)} />
              <p className="mt-1 type-small text-cell-muted">{t("subsidy", { inr: formatInr(r.subsidy_inr, lang) })}</p>
            </div>
            <div className="bg-parapet p-4">
              <Readout
                label={t("payback")}
                value={r.payback_years === null ? "—" : t("years", { n: formatNumber(r.payback_years, lang, 1) })}
              />
            </div>
          </div>
          <p className="mt-3 text-sm">
            {t("perHome", {
              homes: formatNumber(r.homes, lang),
              cost: formatInr(r.per_home.net_cost_inr, lang),
              savings: formatInr(r.per_home.savings_year1_inr, lang),
            })}
          </p>
          <p className="mt-1 type-small text-cell-muted">{t("tariffNote", { tariff: r.tariff })}</p>
          <div className="mt-2">
            <HowCalculated steps={c.working} />
          </div>
        </>
      )}
      {s.is_admin && !editing && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
          {t("update")}
        </Button>
      )}
      {s.is_admin && editing && (
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={form.handleSubmit((v) =>
            run.mutate({ ...v, kw_already_subsidised: v.kw_already_subsidised ?? 0, cost_inr: v.cost_inr || null }),
          )}
        >
          <Field id="cs-discom" label={t("discom")} error={e.discom?.message}>
            <select className={inputClasses} {...form.register("discom")}>
              <option value="">—</option>
              {Object.values(TARIFFS).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.discom}
                </option>
              ))}
            </select>
          </Field>
          <Field id="cs-supply" label={t("supply")}>
            <select className={inputClasses} {...form.register("supply")}>
              <option value="three">{t("supplyThree")}</option>
              <option value="single">{t("supplySingle")}</option>
            </select>
          </Field>
          <Field id="cs-units" label={t("units")} hint={t("unitsHint")} error={e.monthly_units?.message}>
            <Input inputMode="decimal" {...form.register("monthly_units")} />
          </Field>
          <Field id="cs-load" label={t("load")} hint={t("loadHint")} error={e.sanctioned_load_kw?.message}>
            <Input inputMode="decimal" {...form.register("sanctioned_load_kw")} />
          </Field>
          <Field id="cs-terrace" label={t("terrace")} hint={t("terraceHint")} error={e.terrace_area_sqft?.message}>
            <Input inputMode="decimal" {...form.register("terrace_area_sqft")} />
          </Field>
          <Field id="cs-shading" label={t("shading")}>
            <select className={inputClasses} {...form.register("shading")}>
              <option value="none">{t("shadingNone")}</option>
              <option value="partial">{t("shadingPartial")}</option>
              <option value="heavy">{t("shadingHeavy")}</option>
            </select>
          </Field>
          <Field id="cs-already" label={t("already")} hint={t("alreadyHint")} error={e.kw_already_subsidised?.message}>
            <Input inputMode="decimal" {...form.register("kw_already_subsidised")} />
          </Field>
          <Field id="cs-cost" label={t("cost")} hint={t("costHint")} error={e.cost_inr?.message}>
            <Input inputMode="numeric" {...form.register("cost_inr")} />
          </Field>
          {failure && (
            <p role="alert" className="text-sm text-alert sm:col-span-2">
              {failure}
            </p>
          )}
          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" disabled={run.isPending}>
              {run.isPending ? t("working") : t("estimate")}
            </Button>
            {c && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function Leave({ s }: { s: Society }) {
  const t = useTranslations("societyPage.leave");
  const set = useSetSociety();
  const [asking, setAsking] = useState(false);
  const leave = useMutation({
    mutationFn: leaveSociety,
    onSuccess: () => {
      set(null);
      toast(t("done"));
    },
  });
  if (!asking)
    return (
      <Button variant="ghost" onClick={() => setAsking(true)}>
        {t("button")}
      </Button>
    );
  return (
    <div role="group" aria-label={t("button")} className="rounded-panel border border-alert/40 p-4">
      <p className="text-sm">{t("confirm", { name: s.name })}</p>
      {s.is_admin && s.members > 1 && <p className="mt-1 type-small text-cell-muted">{t("adminNote")}</p>}
      <div className="mt-3 flex gap-3">
        <Button variant="danger" size="sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
          {t("yes")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

export function SocietyPage() {
  const t = useTranslations("societyPage");
  const params = useSearchParams();
  const q = useQuery({ queryKey: KEY, queryFn: getSociety });
  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-[1200px]" />;
  if (q.isError) return <p role="alert" className="text-alert">{t("errors.generic")}</p>;
  const s = q.data;

  if (!s) {
    const code = (params.get("code") ?? "").toUpperCase().slice(0, 10);
    return (
      <div className="mx-auto max-w-[1200px] space-y-8">
        <PageHeader title={t("title")} />
        <p className="-mt-4 max-w-[60ch] text-cell-muted">{t("intro")}</p>
        <div className={cn("grid gap-6 lg:grid-cols-2", code && "lg:[&>*:first-child]:order-2")}>
          <CreateForm />
          <JoinForm initialCode={code} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      <PageHeader title={s.name}>
        <p className="type-small text-cell-muted">
          {s.city}
          {s.is_admin && <span className="ml-3 rounded-[4px] border border-concrete px-1.5">{t("adminBadge")}</span>}
        </p>
      </PageHeader>
      <Stats s={s} />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <Leaderboard s={s} />
          <CommonSolar s={s} />
          <Announcements s={s} />
          <Tanks s={s} />
        </div>
        <div className="space-y-6 lg:col-span-5">
          <Button asChild variant="secondary" className="w-full">
            <Link href="/app/society/report">
              <FileText aria-hidden strokeWidth={1.75} />
              {t("report.open")}
            </Link>
          </Button>
          <Invite s={s} />
          <You key={JSON.stringify(s.me)} s={s} />
          <Leave s={s} />
        </div>
      </div>
    </div>
  );
}
