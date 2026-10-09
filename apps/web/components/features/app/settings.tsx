"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/features/app/app-shell";
import { useProfile, useSaveProfile } from "@/components/features/app/use-profile";
import { useAuth } from "@/components/providers/app-providers";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClasses } from "@/components/ui/field";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useRouter } from "@/i18n/navigation";
import { deleteAccount, exportData, type Profile } from "@/lib/api";
import { setFlash } from "@/lib/flash";
import { TARIFFS } from "@/lib/calc/tariff";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `s-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t border-concrete py-8 lg:grid-cols-12">
      <h2 id={id} className="type-heading text-xl lg:col-span-4">
        {title}
      </h2>
      <div className="lg:col-span-8">{children}</div>
    </section>
  );
}

const num = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().min(min).max(max).nullable(),
  );

function DetailsForm({ profile }: { profile: Profile }) {
  const t = useTranslations("settings");
  const to = useTranslations("onboarding");
  const save = useSaveProfile();
  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    roof_area_sqft: num(10, 200_000),
    household_size: num(1, 40),
    discom: z.string().nullable(),
    supply: z.enum(["single", "three"]),
    sanctioned_load_kw: num(0.1, 200),
    tank_litres: num(0, 1_000_000),
    water_inr_per_kl: num(0, 10_000),
    tanker_litres: num(1, 50_000),
    inr_per_tanker: num(0, 100_000),
  });
  type In = z.input<typeof schema>;
  const form = useForm<In, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: profile.name ?? "",
      roof_area_sqft: profile.roof_area_sqft ?? "",
      household_size: profile.household_size ?? "",
      discom: profile.discom ?? null,
      supply: profile.supply ?? "single",
      sanctioned_load_kw: profile.sanctioned_load_kw ?? "",
      tank_litres: profile.tank_litres ?? "",
      water_inr_per_kl: profile.water_inr_per_kl ?? "",
      tanker_litres: profile.tanker_litres ?? "",
      inr_per_tanker: profile.inr_per_tanker ?? "",
    },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit((v) =>
    save.mutate(v, {
      onSuccess: () => {
        toast(t("saved"));
        form.reset(form.getValues());
      },
    }),
  );
  return (
    <form onSubmit={onSubmit} noValidate>
      <Section title={t("profile")}>
        <Field id="name" label={to("you.name")} error={e.name && to("errors.name")}>
          <Input autoComplete="name" className="max-w-md" {...form.register("name")} />
        </Field>
      </Section>
      <Section title={t("home")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="roof" label={to("home.roof")} hint={to("home.roofHint")} error={e.roof_area_sqft && to("errors.roof")}>
            <Input inputMode="decimal" {...form.register("roof_area_sqft")} />
          </Field>
          <Field id="household" label={to("home.household")} error={e.household_size && to("errors.household")}>
            <Input inputMode="numeric" {...form.register("household_size")} />
          </Field>
          <Field id="tank" label={to("water.tank")} error={e.tank_litres && to("errors.tank")}>
            <Input inputMode="numeric" {...form.register("tank_litres")} />
          </Field>
        </div>
      </Section>
      <Section title={t("water")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="water-rate" label={t("waterRate")} hint={t("waterRateHint")} error={e.water_inr_per_kl && to("errors.number")}>
            <Input inputMode="decimal" {...form.register("water_inr_per_kl")} />
          </Field>
          <Field id="tanker-litres" label={t("tankerLitres")} error={e.tanker_litres && to("errors.number")}>
            <Input inputMode="numeric" {...form.register("tanker_litres")} />
          </Field>
          <Field id="tanker-cost" label={t("tankerCost")} error={e.inr_per_tanker && to("errors.number")}>
            <Input inputMode="numeric" {...form.register("inr_per_tanker")} />
          </Field>
        </div>
      </Section>
      <Section title={t("electricity")}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="discom" label={to("electricity.discom")}>
            <select className={inputClasses} {...form.register("discom", { setValueAs: (v: string) => (v === "" ? null : v) })}>
              <option value="">—</option>
              {Object.values(TARIFFS).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.discom}
                </option>
              ))}
              <option value="other">{to("electricity.discomOther")}</option>
            </select>
          </Field>
          <Field id="supply" label={to("electricity.supply")}>
            <select className={inputClasses} {...form.register("supply")}>
              <option value="single">{to("electricity.supplySingle")}</option>
              <option value="three">{to("electricity.supplyThree")}</option>
            </select>
          </Field>
          <Field id="load" label={to("electricity.load")} hint={to("electricity.loadHint")} error={e.sanctioned_load_kw && to("errors.load")}>
            <Input inputMode="decimal" {...form.register("sanctioned_load_kw")} />
          </Field>
        </div>
        {save.isError && (
          <p role="alert" className="mt-4 text-sm text-alert">
            {to("saveError")}
          </p>
        )}
        <Button type="submit" className="mt-6" disabled={save.isPending || !form.formState.isDirty}>
          {t("save")}
        </Button>
      </Section>
    </form>
  );
}

function RemindersSection({ profile }: { profile: Profile }) {
  const t = useTranslations("settings");
  const save = useSaveProfile();
  const [on, setOn] = useState(Boolean(profile.leak_reminders));
  return (
    <Section title={t("reminders")}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--cell)]"
          checked={on}
          disabled={save.isPending}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            save.mutate(
              { leak_reminders: next },
              { onSuccess: () => toast(t("saved")), onError: () => setOn(!next) },
            );
          }}
        />
        <span>
          <span className="block font-medium">{t("leakReminders")}</span>
          <span className="mt-1 block text-sm text-cell-muted">{t("leakRemindersHint")}</span>
        </span>
      </label>
      {save.isError && (
        <p role="alert" className="mt-4 text-sm text-alert">
          {t("remindersError")}
        </p>
      )}
    </Section>
  );
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(items: Record<string, unknown>[]): string {
  const cols = [...new Set(items.flatMap((i) => Object.keys(i)))];
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(","), ...items.map((i) => cols.map((c) => cell(i[c])).join(","))].join("\n") + "\n";
}

function DataSection() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState<"json" | "csv" | "delete" | null>(null);
  const [confirm, setConfirm] = useState("");
  const [deleteError, setDeleteError] = useState(false);
  const word = t("deleteWord");

  const doExport = async (kind: "json" | "csv") => {
    setBusy(kind);
    try {
      const data = await exportData();
      const stamp = data.exported_at.slice(0, 10);
      if (kind === "json") download(`groundwork-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      else download(`groundwork-${stamp}.csv`, toCsv(data.items), "text/csv");
    } catch {
      toast.error(t("exportError"));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    setBusy("delete");
    setDeleteError(false);
    try {
      await deleteAccount();
      setFlash("deleted");
      await signOut().catch(() => undefined);
      qc.clear();
      router.replace("/");
    } catch {
      setDeleteError(true);
      setBusy(null);
    }
  };

  return (
    <Section title={t("data")}>
      <div>
        <h3 className="type-heading text-lg">{t("exportTitle")}</h3>
        <p className="mt-1 text-sm text-cell-muted">{t("exportBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void doExport("json")} disabled={busy !== null}>
            {t("exportJson")}
          </Button>
          <Button variant="secondary" onClick={() => void doExport("csv")} disabled={busy !== null}>
            {t("exportCsv")}
          </Button>
        </div>
      </div>
      <div className="mt-10 rounded-panel border border-alert/40 p-5">
        <h3 className="type-heading text-lg">{t("deleteTitle")}</h3>
        <p className="mt-1 text-sm text-cell-muted">{t("deleteBody")}</p>
        <Sheet onOpenChange={(open) => !open && setConfirm("")}>
          <SheetTrigger asChild>
            <Button variant="danger" className="mt-4">
              {t("deleteCta")}
            </Button>
          </SheetTrigger>
          <SheetContent side="center" closeLabel={tc("close")}>
            <SheetHeader>
              <SheetTitle>{t("deleteConfirmTitle")}</SheetTitle>
              <SheetDescription>{t("deleteConfirmBody", { word })}</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <Field id="confirm-delete" label={t("deleteConfirmBody", { word })} className="mt-4 [&_label]:sr-only">
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </Field>
              {deleteError && (
                <p role="alert" className="mt-3 text-sm text-alert">
                  {t("deleteError")}
                </p>
              )}
              <Button
                variant="danger"
                className="mt-5 w-full"
                disabled={confirm.trim() !== word || busy === "delete"}
                onClick={() => void doDelete()}
              >
                {busy === "delete" ? t("deleting") : t("deleteConfirmCta")}
              </Button>
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const t = useTranslations("settings");
  const { data } = useProfile();
  if (!data) return null;
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title={t("title")} />
      <DetailsForm profile={data} />
      <RemindersSection profile={data} />
      <DataSection />
    </div>
  );
}
