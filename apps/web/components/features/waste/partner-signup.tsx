"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { applyAsPartner } from "@/lib/api";
import WASTE from "@/lib/calc/data/waste.json";

/** Materials a scrap dealer or recycler might buy: everything except the streams that go to the municipality. */
const BUYABLE = WASTE.materials.filter((m) => !["wet", "sanitary", "special_care", "other"].includes(m.id)).map((m) => m.id);

export function PartnerSignup() {
  const t = useTranslations("waste.join");
  const tm = useTranslations("waste.materials");
  const schema = z.object({
    name: z.string().trim().min(2, t("errors.name")).max(80),
    area: z.string().trim().min(2, t("errors.area")).max(80),
    city: z.string().trim().min(2, t("errors.city")).max(60),
    materials: z.array(z.string()).min(1, t("errors.materials")),
    phone: z.string().trim().regex(/^\+?[0-9 ]{8,16}$/, t("errors.phone")),
    email: z.union([z.literal(""), z.string().trim().email(t("errors.email")).max(120)]),
  });
  type In = z.infer<typeof schema>;
  const form = useForm<In>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", area: "", city: "", materials: [], phone: "", email: "" },
  });
  const send = useMutation({ mutationFn: (v: In) => applyAsPartner({ ...v, email: v.email || undefined }) });
  const e = form.formState.errors;

  if (send.isSuccess)
    return (
      <p role="status" className="flex items-start gap-2 rounded-panel border border-leaf/40 bg-parapet p-5">
        <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-leaf" strokeWidth={2} />
        {t("done")}
      </p>
    );

  return (
    <form onSubmit={form.handleSubmit((v) => send.mutate(v))} noValidate className="grid gap-5 rounded-panel border border-concrete bg-parapet p-5 sm:grid-cols-2 sm:p-6">
      <Field id="partner-name" label={t("name")} error={e.name?.message} className="sm:col-span-2">
        <Input autoComplete="organization" {...form.register("name")} />
      </Field>
      <Field id="partner-area" label={t("area")} error={e.area?.message}>
        <Input {...form.register("area")} />
      </Field>
      <Field id="partner-city" label={t("city")} error={e.city?.message}>
        <Input autoComplete="address-level2" {...form.register("city")} />
      </Field>
      <fieldset className="sm:col-span-2" aria-describedby={e.materials ? "partner-materials-error" : undefined}>
        <legend className="type-ui text-sm">{t("materials")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {BUYABLE.map((id) => (
            <label key={id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-input border border-field px-3 text-sm has-[:checked]:border-cell">
              <input type="checkbox" value={id} className="size-4 accent-[var(--cell)]" {...form.register("materials")} />
              {tm(id as "pet")}
            </label>
          ))}
        </div>
        {e.materials && (
          <p id="partner-materials-error" role="alert" className="mt-1.5 type-small text-alert">
            {e.materials.message}
          </p>
        )}
      </fieldset>
      <Field id="partner-phone" label={t("phone")} error={e.phone?.message}>
        <Input type="tel" autoComplete="tel" {...form.register("phone")} />
      </Field>
      <Field id="partner-email" label={t("email")} optionalLabel={t("optional")} error={e.email?.message}>
        <Input type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <p className="type-small text-cell-muted sm:col-span-2">{t("privacy")}</p>
      {send.isError && (
        <p role="alert" className="text-sm text-alert sm:col-span-2">
          {t("error")}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={send.isPending}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
