"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";

import { Terrace } from "@/components/brand/terrace";
import { PageHeader } from "@/components/features/app/app-shell";
import { ReportView } from "@/components/features/solar/report-view";
import { EmptyState } from "@/components/ui/blocks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Link, useRouter } from "@/i18n/navigation";
import { useState } from "react";

import { Field, Input } from "@/components/ui/field";
import {
  ApiFailure,
  createReport,
  getHome,
  getReport,
  getSharedReport,
  listReports,
  markInstalled,
  shareReport,
  unmarkInstalled,
} from "@/lib/api";
import { TARIFFS } from "@/lib/calc/tariff";
import { formatInr, formatNumber } from "@/lib/format";

export function SolarList() {
  const t = useTranslations("solar");
  const lang = useLocale();
  const format = useFormatter();
  const q = useQuery({ queryKey: ["solar-reports"], queryFn: listReports });
  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title={t("title")}>
        {q.data && q.data.length > 0 && (
          <Button asChild>
            <Link href="/app/solar/new">{t("newCta")}</Link>
          </Button>
        )}
      </PageHeader>
      {q.isPending && <Skeleton className="h-40 w-full" />}
      {q.isError && <p role="alert" className="text-alert">{t("report.shareFailed")}</p>}
      {q.data && q.data.length === 0 && (
        <EmptyState
          art={<Terrace panels={0} title={t("listEmptyTitle")} className="h-auto w-full" />}
          title={t("listEmptyTitle")}
          body={t("listEmptyBody")}
          action={
            <Button asChild>
              <Link href="/app/solar/new">{t("newCta")}</Link>
            </Button>
          }
        />
      )}
      {q.data && q.data.length > 0 && (
        <section aria-labelledby="reports">
          <h2 id="reports" className="sr-only">{t("listTitle")}</h2>
          <ul className="divide-y divide-concrete rounded-panel border border-concrete bg-parapet">
            {q.data.map((r) => (
              <li key={r.id}>
                <Link href={`/app/solar/${r.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-limewash/60">
                  <span aria-hidden className="h-10 w-1 rounded-full bg-sun" />
                  <span className="min-w-0 flex-1">
                    <span className="block type-heading text-base">
                      {!r.feasible
                        ? t("listNotFeasible")
                        : r.payback_years !== null
                          ? t("listItem", { kw: formatNumber(r.size_kw, lang, 1), years: formatNumber(r.payback_years, lang, 1) })
                          : t("listItemNoPayback", { kw: formatNumber(r.size_kw, lang, 1) })}
                    </span>
                    <span className="block type-small text-cell-muted">
                      {format.dateTime(new Date(r.created_at), { dateStyle: "medium" })}
                      {r.discom && ` · ${TARIFFS[r.discom]?.discom ?? r.discom}`}
                    </span>
                  </span>
                  {r.feasible && (
                    <span className="hidden text-right sm:block">
                      <span className="block type-number text-lg text-leaf">{formatInr(r.savings_year1_inr, lang)}</span>
                      <span className="block type-small text-cell-muted">{t("report.yearOne")}</span>
                    </span>
                  )}
                  <ChevronRight aria-hidden className="size-4 text-cell-muted" strokeWidth={1.75} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SolarReportPage({ id }: { id: string }) {
  const t = useTranslations("solar.report");
  const format = useFormatter();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["solar-report", id], queryFn: () => getReport(id) });
  const share = useMutation({
    mutationFn: () => shareReport(id),
    onSuccess: async ({ token }) => {
      const url = `${window.location.origin}/share/${token}`;
      try {
        if (navigator.share) await navigator.share({ title: t("title"), url });
        else await navigator.clipboard.writeText(url);
        toast(t("shareCopied"));
      } catch {
        // the user closed the share sheet
      }
    },
  });

  if (q.isPending) return <Skeleton className="mx-auto h-96 max-w-[1200px]" />;
  if (q.isError) {
    const missing = q.error instanceof ApiFailure && q.error.status === 404;
    return (
      <div className="mx-auto max-w-[1200px]" role="alert">
        <p className="type-heading text-xl">{missing ? t("notFound") : t("shareFailed")}</p>
        <Button asChild variant="secondary" className="mt-6">
          <Link href="/app/solar">{t("back")}</Link>
        </Button>
      </div>
    );
  }
  const data = q.data;
  return (
    <div className="mx-auto max-w-[1200px]">
      <Link href="/app/solar" className="type-small text-cell-muted hover:text-cell print:hidden">
        ← {t("back")}
      </Link>
      <PageHeader title={t("title")} className="mt-2">
        <p className="type-small text-cell-muted">
          {t("created", { date: format.dateTime(new Date(data.created_at), { dateStyle: "long" }) })}
        </p>
      </PageHeader>
      {data.report.feasible && <InstalledPanel reportId={data.id} />}
      <ReportView
        data={data}
        onShare={async () => {
          await share.mutateAsync();
        }}
        onSaveScenario={async (scenario) => {
          if (!data.bill_id) return;
          const roof = data.inputs.roof;
          const created = await createReport(
            data.bill_id,
            { lat: roof.lat!, lng: roof.lng!, roof_area_sqft: roof.roof_area_sqft, shading: roof.shading },
            scenario,
          );
          await qc.invalidateQueries({ queryKey: ["solar-reports"] });
          await qc.invalidateQueries({ queryKey: ["ledger"] });
          router.push(`/app/solar/${created.id}`);
        }}
      />
    </div>
  );
}

export function SharedReportPage({ token }: { token: string }) {
  const t = useTranslations("solar.shared");
  const q = useQuery({ queryKey: ["shared", token], queryFn: () => getSharedReport(token), retry: false });
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
      <h1 className="type-display text-3xl sm:text-4xl">{t("title")}</h1>
      {q.isPending && <Skeleton className="mt-8 h-96 w-full" />}
      {q.isError && (
        <div role="alert" className="mt-6">
          <p className="text-lg text-cell-muted">{t("expired")}</p>
        </div>
      )}
      {q.data && (
        <>
          <p className="mt-3 max-w-[60ch] text-cell-muted">{t("intro")}</p>
          <div className="mt-10">
            <ReportView data={q.data} shared />
          </div>
        </>
      )}
      <Button asChild className="mt-12">
        <Link href="/signup">{t("cta")}</Link>
      </Button>
    </div>
  );
}

function InstalledPanel({ reportId }: { reportId: string }) {
  const t = useTranslations("solar.report");
  const format = useFormatter();
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ["home"], queryFn: getHome });
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const refresh = async () => {
    await Promise.all(["home", "ledger"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
  const mark = useMutation({ mutationFn: () => markInstalled(reportId, date), onSuccess: refresh });
  const undo = useMutation({ mutationFn: unmarkInstalled, onSuccess: refresh });
  const installed = home.data?.installed;
  if (!home.data) return null;
  if (installed && installed.report_id === reportId) {
    return (
      <div role="status" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-panel border border-leaf/40 bg-parapet px-4 py-3 print:hidden">
        <div>
          <p className="type-ui text-sm text-leaf">
            {t("installed", { date: format.dateTime(new Date(installed.installed_on), { dateStyle: "long" }) })}
          </p>
          <p className="type-small text-cell-muted">{t("installedNote")}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={undo.isPending} onClick={() => undo.mutate()}>
          {t("uninstall")}
        </Button>
      </div>
    );
  }
  if (installed) return null; // another report is the installed one
  return (
    <div className="mb-8 rounded-panel border border-concrete bg-parapet px-4 py-3 print:hidden">
      {!open ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-ui text-sm">{t("installTitle")}</p>
            <p className="type-small text-cell-muted">{t("installBody")}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t("installCta")}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mark.mutate();
          }}
        >
          <Field id="installed-on" label={t("installDate")} error={mark.isError ? t("installError") : undefined}>
            <Input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Button type="submit" size="sm" className="mb-0.5" disabled={mark.isPending || !date}>
            {t("installSave")}
          </Button>
        </form>
      )}
    </div>
  );
}
