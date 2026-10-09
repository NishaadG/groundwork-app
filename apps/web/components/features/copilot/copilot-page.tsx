"use client";

import { AlertTriangle, ArrowUp, ImagePlus, Plus, Square, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/features/app/app-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { ApiFailure, type ChatCard, getChatHistory, presignUpload, streamChat, uploadToS3 } from "@/lib/api";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "bill" | "meter" | "waste";
interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  cards: ChatCard[];
  status?: string;
  error?: string;
  attachment?: Kind;
}

const SESSION_KEY = "gw.copilot.session";
let nextId = 1;

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSession(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: the chat just won't survive a reload */
  }
}

function CardFrame({ title, tone, children }: { title: string; tone?: "alert"; children: React.ReactNode }) {
  return (
    <div className={cn("mt-3 rounded-input border bg-parapet p-4", tone === "alert" ? "border-alert/50" : "border-concrete")}>
      <p className={cn("type-ui text-sm", tone === "alert" && "text-alert")}>{title}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="type-small text-cell-muted">{label}</dt>
      <dd className="type-number text-lg">{value}</dd>
    </div>
  );
}

function Card({ card }: { card: ChatCard }) {
  const t = useTranslations("copilotPage.cards");
  const tw = useTranslations("waste");
  const lang = useLocale();
  const format = useFormatter();
  switch (card.type) {
    case "solar_summary": {
      const d = card.data;
      return (
        <CardFrame title={t("solarTitle")}>
          {d.feasible ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("size")} value={`${formatNumber(d.size_kw, lang, 1)} kW`} />
              <Stat label={t("netCost")} value={formatInr(d.net_cost_inr, lang)} />
              <Stat label={t("savings")} value={formatInr(d.savings_year1_inr, lang)} />
              <Stat label={t("payback")} value={d.payback_years === null ? "—" : t("years", { n: formatNumber(d.payback_years, lang, 1) })} />
            </dl>
          ) : (
            <p>{t("notFeasible")}</p>
          )}
          <Link href={`/app/solar/${d.id}`} className="mt-3 inline-block underline underline-offset-4">
            {t("openReport")}
          </Link>
        </CardFrame>
      );
    }
    case "leak_alert":
      return (
        <CardFrame title={t("leakTitle")} tone="alert">
          <p className="flex items-center gap-2">
            <AlertTriangle aria-hidden className="size-4 text-alert" strokeWidth={2} />
            {t("leakBody", { litres: formatNumber(card.data.litres_per_day, lang), date: format.dateTime(new Date(card.data.detected_at), { dateStyle: "medium" }) })}
          </p>
          <Link href="/app/water" className="mt-2 inline-block underline underline-offset-4">
            {t("openWater")}
          </Link>
        </CardFrame>
      );
    case "water_summary": {
      const d = card.data;
      return (
        <CardFrame title={t("waterTitle")}>
          {d.litres_per_day === null ? (
            <p>{t("noReadings")}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3">
              <Stat label={t("perDay")} value={`${formatNumber(d.litres_per_day, lang)} L`} />
              {d.lpcd !== null && <Stat label={t("perPerson")} value={`${formatNumber(d.lpcd, lang)} L`} />}
            </dl>
          )}
          {d.benchmark_lpcd !== null && <p className="mt-2 type-small text-cell-muted">{t("benchmark", { lpcd: formatNumber(d.benchmark_lpcd, lang) })}</p>}
          <Link href="/app/water" className="mt-2 inline-block underline underline-offset-4">
            {t("openWater")}
          </Link>
        </CardFrame>
      );
    }
    case "waste_items":
      return (
        <CardFrame title={t("wasteTitle")}>
          <ul className="divide-y divide-concrete">
            {card.data.items.map((i, n) => (
              <li key={n} className="flex items-baseline justify-between gap-3 py-1.5">
                <span>{i.label}</span>
                <span className="type-small text-cell-muted">{tw(`streams.${i.stream}`)}</span>
              </li>
            ))}
          </ul>
          <Link href="/app/waste" className="mt-2 inline-block underline underline-offset-4">
            {t("openWaste")}
          </Link>
        </CardFrame>
      );
    case "ledger_snapshot": {
      const r = card.data.realised;
      const entries = (["inr", "kwh", "litres", "kg", "co2_t"] as const).filter((m) => r[m]);
      const fmt = (m: (typeof entries)[number], v: number) =>
        m === "inr" ? formatInr(v, lang) : m === "kwh" ? `${formatNumber(v, lang)} kWh` : m === "litres" ? `${formatNumber(v, lang)} L` : m === "kg" ? `${formatNumber(v, lang, 1)} kg` : `${formatNumber(v, lang, 2)} t CO₂`;
      return (
        <CardFrame title={t("ledgerTitle")}>
          {entries.length === 0 ? (
            <p>{t("nothingYet")}</p>
          ) : (
            <p className="type-number text-lg">{entries.map((m) => fmt(m, r[m]!)).join(" · ")}</p>
          )}
        </CardFrame>
      );
    }
    case "bill_read":
      return (
        <CardFrame title={t("billTitle")}>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(["units_kwh", "total_amount_inr", "period_start", "period_end", "sanctioned_load_kw"] as const)
              .filter((k) => card.data.fields[k] !== null && card.data.fields[k] !== undefined)
              .map((k) => (
                <Stat
                  key={k}
                  label={card.data.unsure.includes(k) ? `${t(`fields.${k}`)} · ${t("unsure")}` : t(`fields.${k}`)}
                  value={String(card.data.fields[k])}
                />
              ))}
          </dl>
          <Link href="/app/solar/new" className="mt-3 inline-block underline underline-offset-4">
            {t("makeReport")}
          </Link>
        </CardFrame>
      );
    case "meter_read":
      return (
        <CardFrame title={t("meterTitle")}>
          <p className="type-number text-lg">{card.data.litres === null ? t("meterUnread") : `${formatNumber(card.data.litres, lang)} L`}</p>
          <Link href="/app/water" className="mt-2 inline-block underline underline-offset-4">
            {t("openWater")}
          </Link>
        </CardFrame>
      );
  }
}

export function CopilotPage() {
  const t = useTranslations("copilotPage");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<{ kind: Kind; key: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const session = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<Kind>("waste");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore this tab's conversation after a reload
  useEffect(() => {
    const id = readSession();
    if (!id) return;
    session.current = id;
    getChatHistory(id)
      .then(({ turns }) => setMessages(turns.map((x) => ({ id: nextId++, role: x.role, text: x.text, cards: [] }))))
      .catch(() => writeSession(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  const update = (id: number, fn: (m: Message) => Message) => setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || uploading) return;
    const att = attachment;
    const reply: Message = { id: nextId++, role: "assistant", text: "", cards: [], status: t("thinking") };
    setMessages((all) => [...all, { id: nextId++, role: "user", text: message, cards: [], attachment: att?.kind }, reply]);
    setInput("");
    setAttachment(null);
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamChat(
        { session_id: session.current ?? undefined, message, attachment: att ? { kind: att.kind, s3_key: att.key } : undefined },
        (e) => {
          if (e.event === "token") update(reply.id, (m) => ({ ...m, text: m.text + e.data.text, status: undefined }));
          else if (e.event === "tool_start") {
            const known = ["solar_agent", "water_agent", "waste_agent", "get_ledger"];
            const label = known.includes(e.data.name) ? t(`tools.${e.data.name as "solar_agent"}`) : t("tools.default");
            update(reply.id, (m) => (m.text ? m : { ...m, status: `${label}…` }));
          } else if (e.event === "card") update(reply.id, (m) => ({ ...m, cards: [...m.cards, e.data] }));
          else if (e.event === "done") {
            session.current = e.data.session_id;
            writeSession(e.data.session_id);
            update(reply.id, (m) => ({ ...m, status: undefined }));
          } else if (e.event === "error")
            update(reply.id, (m) => ({ ...m, status: undefined, error: e.data.code === "ai_unavailable" ? t("unavailable") : t("error") }));
        },
        controller.signal,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const msg = err instanceof ApiFailure && err.status === 429 ? t("rateLimited") : t("error");
        update(reply.id, (m) => ({ ...m, status: undefined, error: msg }));
      } else update(reply.id, (m) => ({ ...m, status: undefined }));
    } finally {
      setBusy(false);
      abort.current = null;
      inputRef.current?.focus();
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setUploadError(false);
    try {
      const p = await presignUpload(pendingKind.current, file.type);
      await uploadToS3(p, file);
      setAttachment({ kind: pendingKind.current, key: p.key });
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  };

  const kindLabel = (k: Kind) => (k === "bill" ? t("attachBill") : k === "meter" ? t("attachMeter") : t("attachWaste"));

  return (
    <div className="mx-auto flex max-w-[860px] flex-col">
      <PageHeader title={t("title")} className="mb-4 w-full">
        {messages.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              session.current = null;
              writeSession(null);
            }}
          >
            <Plus aria-hidden strokeWidth={1.75} />
            {t("newChat")}
          </Button>
        )}
      </PageHeader>
      <p className="max-w-[65ch] text-sm text-cell-muted">{t("intro")}</p>

      <div role="log" aria-live="polite" aria-label={t("title")} className="mt-6 space-y-5 pb-4">
        {messages.length === 0 && (
          <section aria-labelledby="suggestions">
            <h2 id="suggestions" className="type-ui text-sm text-cell-muted">
              {t("suggestionsTitle")}
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {(["s1", "s2", "s3", "s4"] as const).map((k) => (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => void send(t(`suggestions.${k}`))}
                    className="min-h-11 w-full cursor-pointer rounded-input border border-concrete bg-parapet px-4 py-3 text-left text-sm hover:border-cell"
                  >
                    {t(`suggestions.${k}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-panel bg-cell px-4 py-2.5 text-on-cell">
                <p className="sr-only">{t("you")}:</p>
                {m.attachment && <p className="mb-1 type-small opacity-80">{t("attached", { kind: kindLabel(m.attachment) })}</p>}
                <p className="whitespace-pre-line">{m.text}</p>
              </div>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%]">
              <p className="sr-only">{t("assistant")}:</p>
              {m.text && <p className="whitespace-pre-line leading-relaxed">{m.text}</p>}
              {m.status && (
                <p className="flex items-center gap-2 type-small text-cell-muted">
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-cell-muted motion-reduce:animate-none" />
                  {m.status}
                </p>
              )}
              {m.cards.map((c, i) => (
                <Card key={i} card={c} />
              ))}
              {m.error && (
                <p role="alert" className="mt-2 text-sm text-alert">
                  {m.error}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-2 rounded-panel border border-concrete bg-parapet p-2 shadow-sheet md:bottom-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {(attachment || uploading || uploadError) && (
          <div className="flex items-center gap-2 px-2 pt-1 pb-2 type-small">
            {uploading ? (
              <span className="text-cell-muted">{t("uploading")}</span>
            ) : uploadError ? (
              <span role="alert" className="text-alert">
                {t("uploadFailed")}
              </span>
            ) : (
              attachment && (
                <>
                  <span className="rounded-[4px] border border-concrete px-1.5">{t("attached", { kind: kindLabel(attachment.kind) })}</span>
                  <button type="button" aria-label={t("removeAttachment")} className="cursor-pointer text-cell-muted hover:text-cell" onClick={() => setAttachment(null)}>
                    <X aria-hidden className="size-4" strokeWidth={1.75} />
                  </button>
                </>
              )
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={t("attach")} disabled={busy || uploading}>
                <ImagePlus aria-hidden strokeWidth={1.75} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(["bill", "meter", "waste"] as const).map((k) => (
                <DropdownMenuItem
                  key={k}
                  onSelect={() => {
                    pendingKind.current = k;
                    fileRef.current?.click();
                  }}
                >
                  {kindLabel(k)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <label htmlFor="copilot-input" className="sr-only">
            {t("placeholder")}
          </label>
          <textarea
            id="copilot-input"
            ref={inputRef}
            rows={1}
            maxLength={2000}
            value={input}
            placeholder={t("placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base outline-none placeholder:text-cell-muted [field-sizing:content]"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" aria-label={t("stop")} onClick={() => abort.current?.abort()}>
              <Square aria-hidden strokeWidth={1.75} />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label={t("send")} disabled={!input.trim() || uploading}>
              <ArrowUp aria-hidden strokeWidth={2} />
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="copilot-file"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </form>
      <p className="mt-2 text-center type-small text-cell-muted">{t("aiNote")}</p>
    </div>
  );
}
