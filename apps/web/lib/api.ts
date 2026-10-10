"use client";

import type { WorkingStep } from "@/components/features/working/working-steps";
import { authClient } from "@/lib/auth";
import type { SolarResult } from "@/lib/calc/solar";
import type { BillContext, Tariff } from "@/lib/calc/tariff";

/** Typed client for the Groundwork API (`{data, error: {code, message}}` envelope). */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export class ApiFailure extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (!API_URL) throw new ApiFailure("api_not_configured", 0, "API URL is not set");
  const token = await authClient().idToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(init.body !== undefined && { "Content-Type": "application/json" }),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiFailure("network", 0, "Network request failed");
  }
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiFailure("bad_response", res.status, `Unexpected response (${res.status})`);
  }
  if (!res.ok || body.error) {
    const e = body.error ?? { code: "http_error", message: `HTTP ${res.status}` };
    throw new ApiFailure(e.code, res.status, e.message, e.details);
  }
  return body.data as T;
}

/* ---- Profile (/v1/me) ---- */

export type HomeType = "flat" | "independent_house" | "bungalow";
export type WaterSource = "municipal" | "borewell" | "tanker" | "mixed";
export type Shading = "none" | "partial" | "heavy";

export interface ProfileFields {
  name?: string | null;
  lang?: "en" | "hi" | "mr" | null;
  home_type?: HomeType | null;
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  roof_area_sqft?: number | null;
  shading?: Shading | null;
  household_size?: number | null;
  discom?: string | null;
  supply?: "single" | "three" | null;
  sanctioned_load_kw?: number | null;
  approx_monthly_bill_inr?: number | null;
  water_source?: WaterSource | null;
  tank_litres?: number | null;
  water_inr_per_kl?: number | null;
  tanker_litres?: number | null;
  inr_per_tanker?: number | null;
  onboarding_step?: number | null;
  onboarding_done?: boolean | null;
  leak_reminders?: boolean | null;
}

export interface Profile extends ProfileFields {
  email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export const getProfile = () => api<Profile>("/v1/me");
export const updateProfile = (fields: ProfileFields) =>
  api<Profile>("/v1/me", { method: "PUT", body: fields });
export const exportData = () =>
  api<{ exported_at: string; items: Record<string, unknown>[] }>("/v1/me/export");
export const deleteAccount = () =>
  api<{ deleted_items: number; deleted_files: number }>("/v1/me", { method: "DELETE" });

/* ---- Uploads ---- */

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
  key: string;
  expires_in: number;
  max_bytes: number;
}

export const presignUpload = (kind: "bill" | "meter" | "waste", contentType: string) =>
  api<PresignedUpload>("/v1/uploads/presign", {
    method: "POST",
    body: { kind, content_type: contentType },
  });

/** Uploads straight to S3 with the presigned POST; reports progress 0–1. */
export function uploadToS3(
  p: PresignedUpload,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (file.size > p.max_bytes) {
    return Promise.reject(new ApiFailure("file_too_large", 413, "File too large"));
  }
  const form = new FormData();
  Object.entries(p.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", p.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiFailure("upload_failed", xhr.status, "Upload failed"));
    xhr.onerror = () => reject(new ApiFailure("network", 0, "Upload failed"));
    xhr.send(form);
  });
}

/* ---- Bills & solar reports ---- */


export type Confidence = "high" | "medium" | "low";

export interface ExtractedField {
  value: string | number | null;
  confidence: Confidence;
  evidence: string | null;
  issue: string | null;
}

export interface Extraction {
  discom_id: string | null;
  fields: Record<string, ExtractedField>;
  history: { month: string; units: number }[];
  consumer_name_masked: string | null;
  sample?: boolean;
}

export interface BillIn {
  discom: string;
  units_kwh: number;
  period_start?: string | null;
  period_end?: string | null;
  total_amount_inr?: number | null;
  sanctioned_load_kw?: number | null;
  supply: "single" | "three";
  charges: Record<string, number>;
  history: { month: string; units: number }[];
  source: "manual" | "photo";
  s3_key?: string | null;
  confidence?: Record<string, Confidence>;
}

export interface Roof {
  lat: number;
  lng: number;
  roof_area_sqft: number;
  shading: Shading;
}

export interface Scenario {
  size_kw?: number | null;
  cost_inr?: number | null;
  tariff_escalation?: number | null;
}

export interface YearRow {
  year: number;
  savings_inr: number;
  cumulative_inr: number;
}

export interface StoredReport {
  id: string;
  bill_id?: string;
  discom?: string;
  created_at: string;
  report: SolarResult & { years: YearRow[]; consumption_kwh: number[] };
  working: WorkingStep[];
  bill_check: { computed_total: number; billed_total: number; diff_pct: number; matches: boolean } | null;
  tips?: ReportTips;
  inputs: {
    irradiance_kwh_m2_day: number[];
    irradiance_source: string;
    monthly_units: number[];
    months_from_data?: number;
    roof: Partial<Roof> & { roof_area_sqft: number; shading: Shading };
    bill_context: BillContext;
    scenario: Scenario;
    tariff: Tariff;
  };
}

export interface ReportSummary {
  id: string;
  created_at: string;
  discom: string | null;
  size_kw: number;
  net_cost_inr: number;
  savings_year1_inr: number;
  payback_years: number | null;
  feasible: boolean;
}

export interface LedgerTotals {
  projected: Partial<Record<"inr" | "kwh" | "co2_t" | "litres" | "kg", number>>;
  estimated: Partial<Record<"inr" | "kwh" | "co2_t" | "litres" | "kg", number>>;
  measured: Partial<Record<"inr" | "kwh" | "co2_t" | "litres" | "kg", number>>;
  entries: number;
}

export const extractBill = (s3Key: string) =>
  api<Extraction>("/v1/bills/extract", { method: "POST", body: { s3_key: s3Key } });
export const saveBill = (bill: BillIn) => api<BillIn & { id: string }>("/v1/bills", { method: "POST", body: bill });
export const createReport = (billId: string, roof: Roof, scenario: Scenario = {}) =>
  api<StoredReport>("/v1/solar/reports", { method: "POST", body: { bill_id: billId, roof, scenario } });
export const getReport = (id: string) => api<StoredReport>(`/v1/solar/reports/${encodeURIComponent(id)}`);
export const listReports = () => api<ReportSummary[]>("/v1/solar/reports");
export const shareReport = (id: string) =>
  api<{ token: string; expires_at: string }>(`/v1/solar/reports/${encodeURIComponent(id)}/share`, { method: "POST" });
export const getLedger = () => api<LedgerTotals>("/v1/ledger");

export async function getSharedReport(token: string): Promise<StoredReport> {
  const res = await fetch(`${API_URL}/v1/public/share/${encodeURIComponent(token)}`);
  const body = (await res.json()) as Envelope<StoredReport>;
  if (!res.ok || body.error || !body.data) {
    throw new ApiFailure(body.error?.code ?? "http_error", res.status, body.error?.message ?? "");
  }
  return body.data;
}

export interface ReportTips {
  tips: { title: string; body: string }[];
  rupees_per_unit_cut: number;
  top_slab: string;
  generated_by: string;
}

export const getTips = (id: string) =>
  api<ReportTips>(`/v1/solar/reports/${encodeURIComponent(id)}/tips`, { method: "POST" });

/* ---- Home (Phase 4) ---- */

export interface WorkingCard {
  grade: "A" | "B" | "C" | "D" | "E";
  change_pct: number;
  latest_per_day: number;
  baseline_per_day: number;
  bills_in_baseline: number;
  working: WorkingStep;
}

export type NextAction =
  | { kind: "upload_bill" | "log_bill"; href: string }
  | { kind: "get_quotes"; kw: number; href: string }
  | { kind: "bill_up"; pct: number; href: string };

export type Activity =
  | { type: "bill"; at: string; id: string; units_kwh: number }
  | { type: "solar_report"; at: string; id: string; size_kw: number; feasible: boolean }
  | { type: "solar_installed"; at: string; id: string };

export interface BillSummary {
  id: string;
  month: string;
  units_kwh: number;
  total_amount_inr: number | null;
  period_start: string | null;
  period_end: string | null;
  discom: string;
  created_at: string;
}

type MetricTotals = Partial<Record<"inr" | "kwh" | "co2_t" | "litres" | "kg", number>>;

export interface HomeSummary {
  ledger: {
    projected: MetricTotals;
    estimated: MetricTotals;
    measured: MetricTotals;
    this_month: MetricTotals;
    entries: number;
  };
  ledger_working: WorkingStep[];
  report_card: { energy: WorkingCard | null };
  next_action: NextAction;
  bills: BillSummary[];
  activity: Activity[];
  installed: { report_id: string; installed_on: string; size_kw: number } | null;
}

export const getHome = () => api<HomeSummary>("/v1/home");
export const markInstalled = (reportId: string, installedOn: string) =>
  api<{ report_id: string; installed_on: string }>(
    `/v1/solar/reports/${encodeURIComponent(reportId)}/installed`,
    { method: "POST", body: { installed_on: installedOn } },
  );
export const unmarkInstalled = () => api<{ installed: null }>("/v1/solar/installed", { method: "DELETE" });

/* ---- Water (Phase 5) ---- */

export interface WaterSummary {
  kind: "meter" | "tank" | null;
  series: { day: string; litres: number }[];
  litres_per_day: number | null;
  lpcd: { lpcd: number; benchmark: number; ratio: number; working: WorkingStep } | null;
  anomalies: { day: string; litres: number; upper: number }[];
  tank: { level_pct: number; at: string } | null;
  forecast: {
    days_to_empty: number | null;
    litres_now: number;
    litres_per_day: number;
    tankers_needed: number | null;
    tanker_cost_inr: number | null;
    working: WorkingStep;
  } | null;
  events: {
    id: string;
    type: "leak";
    status: "open" | "fixed";
    litres_per_day: number;
    detected_at: string;
    fixed_at: string | null;
    working: WorkingStep | null;
    saved?: { counted: boolean; litres: number; drop_per_day: number; working: WorkingStep } | null;
  }[];
  open_check: { id: string; kind: "meter" | "tank"; night_at: string } | null;
  latest: { id: string; at: string; kind: "meter" | "tank"; value: number; source: string }[];
  stream: {
    last_at: string;
    count: number;
    nights: { night: string; litres: number; leak: boolean; litres_per_day: number }[];
  } | null;
}

export interface LeakCheckResult {
  leak: boolean;
  result: { litres_per_day: number; window_litres: number; working: WorkingStep };
  event_id: string | null;
}

export const getWater = () => api<WaterSummary>("/v1/water/summary");
export const addWaterReading = (kind: "meter" | "tank", value: number, at?: string, source: "manual" | "photo" = "manual") =>
  api<{ id: string }>("/v1/water/readings", { method: "POST", body: { kind, value, at, source } });
export const startLeakCheck = (kind: "meter" | "tank", value: number, at?: string) =>
  api<{ id: string; night_at: string }>("/v1/water/leak-check", { method: "POST", body: { kind, value, at } });
export const finishLeakCheck = (id: string, value: number, at?: string) =>
  api<LeakCheckResult>(`/v1/water/leak-check/${encodeURIComponent(id)}/finish`, { method: "POST", body: { value, at } });
export const markLeakFixed = (id: string) =>
  api<{ id: string; fixed_at: string }>(`/v1/water/events/${encodeURIComponent(id)}/fixed`, { method: "POST" });
export const readMeterPhoto = (s3Key: string) =>
  api<{ litres: number | null; unit: string; confidence: Confidence; evidence: string | null }>("/v1/water/meter-photo", {
    method: "POST",
    body: { s3_key: s3Key },
  });
export const createDevice = (name: string) =>
  api<{ id: string; name: string; key: string }>("/v1/water/devices", { method: "POST", body: { name } });

/* ---- Waste (Phase 6) ---- */

export type Stream = "wet" | "dry" | "sanitary" | "special_care" | "e_waste";
export type CoachTip = "multilayer" | "cardboard" | "ldpe_film" | "glass" | "ewaste" | "special_care";

export interface ClassifiedItem {
  label: string;
  material: string;
  stream: Stream;
  recyclable: boolean;
  tip: string;
  confidence: Confidence;
}

export interface WasteScan {
  id: string;
  at: string;
  items: { material: string; label: string; stream: Stream; kg: number; inr_min: number | null; inr_max: number | null; co2_kg: number | null; size: string | null }[];
  kg_total: number;
  kg_diverted: number;
  inr_min: number;
  inr_max: number;
  co2_t: number;
  working: WorkingStep[];
}

export interface Partner {
  id: string;
  name: string;
  area: string;
  city: string;
  materials: string[];
  phone: string;
  is_demo: boolean;
}

export const classifyWaste = (s3Key: string) =>
  api<{ items: ClassifiedItem[] }>("/v1/waste/scan", { method: "POST", body: { s3_key: s3Key } });
export const saveWasteScan = (items: { material: string; label?: string; kg?: number; size?: "handful" | "bag" | "sack" }[], s3Key?: string) =>
  api<WasteScan>("/v1/waste/scans", { method: "POST", body: { items, s3_key: s3Key } });
export const deleteWasteScan = (id: string) => api<{ deleted: string }>(`/v1/waste/scans/${encodeURIComponent(id)}`, { method: "DELETE" });
export const getWaste = () =>
  api<{ scans: WasteScan[]; week: { kg_by_stream: Partial<Record<Stream, number>>; kg_total: number; kg_diverted: number; tip: CoachTip | null } }>("/v1/waste/summary");
export const getPartners = (city?: string | null) =>
  api<Partner[]>(`/v1/waste/partners${city ? `?city=${encodeURIComponent(city)}` : ""}`);
export const requestPickup = (partnerId: string, scanId: string, preferredDate: string, note?: string) =>
  api<{ id: string; emailed: boolean; partner: { name: string; phone: string; is_demo: boolean } }>("/v1/waste/pickups", {
    method: "POST",
    body: { partner_id: partnerId, scan_id: scanId, preferred_date: preferredDate, note },
  });

export async function applyAsPartner(body: { name: string; area: string; city: string; materials: string[]; phone: string; email?: string }) {
  if (!API_URL) throw new ApiFailure("api_not_configured", 0, "API URL is not set");
  const res = await fetch(`${API_URL}/v1/public/partners`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Envelope<{ id: string; status: string }>;
  if (!res.ok || json.error) throw new ApiFailure(json.error?.code ?? "http_error", res.status, json.error?.message ?? "");
  return json.data!;
}

/* ---- Society (Phase 7) ---- */

type Totals = Partial<Record<"inr" | "kwh" | "co2_t" | "litres" | "kg", number>>;

export interface Society {
  id: string;
  name: string;
  city: string;
  flats: number;
  invite_code: string;
  is_admin: boolean;
  members: number;
  participation_pct: number;
  totals: { projected: Totals; realised: Totals };
  leaks: { found: number; fixed: number };
  leaderboard: { name: string; is_you: boolean; change_pct: number | null; grade: string | null }[];
  leaderboard_hidden: number;
  me: { flat_label: string | null; nickname: string | null; leaderboard_opt_in: boolean };
  tanks: { name: string; level_pct: number; at: string; history: { at: string; level_pct: number }[] }[];
  announcements: { id: string; text: string; at: string }[];
  common_solar: CommonSolar | null;
  working: WorkingStep[];
}

export interface CommonSolarIn {
  discom: string;
  supply: "single" | "three";
  sanctioned_load_kw: number;
  monthly_units: number;
  terrace_area_sqft: number;
  shading?: "none" | "partial" | "heavy";
  kw_already_subsidised?: number;
  cost_inr?: number | null;
}

export interface CommonSolar {
  inputs: CommonSolarIn;
  result: {
    feasible: boolean;
    size_kw: number;
    annual_generation_kwh: number;
    cost_inr: number;
    subsidy_inr: number;
    net_cost_inr: number;
    savings_year1_inr: number;
    payback_years: number | null;
    savings_25y_net_inr: number;
    co2_avoided_t_per_year: number;
    homes: number;
    per_home: { net_cost_inr: number; savings_year1_inr: number };
    tariff: string;
  };
  working: WorkingStep[];
  updated_at: string;
}

export interface MemberFields {
  flat_label?: string | null;
  nickname?: string | null;
  leaderboard_opt_in?: boolean;
}

export const getSociety = () => api<Society | null>("/v1/society");
export const createSociety = (body: { name: string; city: string; flats: number } & MemberFields) =>
  api<Society>("/v1/society", { method: "POST", body });
export const joinSociety = (body: { code: string } & MemberFields) => api<Society>("/v1/society/join", { method: "POST", body });
export const updateMembership = (body: MemberFields) => api<Society>("/v1/society/me", { method: "PUT", body });
export const estimateCommonSolar = (body: CommonSolarIn) => api<Society>("/v1/society/solar", { method: "POST", body });
export const leaveSociety = () => api<{ left: boolean }>("/v1/society/me", { method: "DELETE" });
export const logSocietyTank = (name: string, levelPct: number) =>
  api<{ tanks: Society["tanks"] }>("/v1/society/tanks", { method: "POST", body: { name, level_pct: levelPct } });
export const postAnnouncement = (text: string) =>
  api<{ announcements: Society["announcements"] }>("/v1/society/announcements", { method: "POST", body: { text } });
export const deleteAnnouncement = (id: string) =>
  api<{ deleted: string }>(`/v1/society/announcements/${encodeURIComponent(id)}`, { method: "DELETE" });

/* ---- Reports (Phase 7) ---- */

export interface ReportCardEntry {
  bill_id: string;
  period_end: string;
  grade: "A" | "B" | "C" | "D" | "E";
  change_pct: number;
  latest_per_day: number;
  baseline_per_day: number;
  bills_in_baseline: number;
  working: WorkingStep;
}

export interface ImpactReport {
  name: string | null;
  city: string | null;
  generated_at: string;
  since: string | null;
  ledger: { projected: Totals; estimated: Totals; measured: Totals };
  working: WorkingStep[];
  activity: {
    bills: number;
    solar_reports: number;
    installed: { installed_on: string; size_kw: number } | null;
    leaks_found: number;
    leaks_fixed: number;
    waste_scans: number;
    waste_kg: number;
    waste_kg_diverted: number;
  };
  sources: { label: string; source: string; url: string | null; as_of: string | null; status: string }[];
}

export interface ReportsOverview {
  solar_reports: { id: string; created_at: string; discom: string | null; size_kw: number; net_cost_inr: number; savings_year1_inr: number; payback_years: number | null; feasible: boolean }[];
  cards: ReportCardEntry[];
  impact: ImpactReport;
}

export const getReports = () => api<ReportsOverview>("/v1/reports");

/* ---- Copilot (Phase 7) ---- */

export type ChatCard =
  | { type: "ledger_snapshot"; data: { realised: Totals; projected: Totals } }
  | { type: "solar_summary"; data: { id: string; feasible: boolean; size_kw: number; cost_inr: number; subsidy_inr: number; net_cost_inr: number; annual_generation_kwh: number; savings_year1_inr: number; payback_years: number | null; co2_avoided_t_per_year: number } }
  | { type: "leak_alert"; data: { litres_per_day: number; detected_at: string } }
  | { type: "water_summary"; data: { litres_per_day: number | null; lpcd: number | null; benchmark_lpcd: number | null; fixed_leaks: number } }
  | { type: "waste_items"; data: { items: ClassifiedItem[] } }
  | { type: "bill_read"; data: { discom: string | null; fields: Record<string, unknown>; unsure: string[] } }
  | { type: "meter_read"; data: { litres: number | null } };

export type ChatEvent =
  | { event: "token"; data: { text: string } }
  | { event: "tool_start"; data: { name: string } }
  | { event: "card"; data: ChatCard }
  | { event: "done"; data: { session_id: string; agents: string[]; tools: string[] } }
  | { event: "error"; data: { code: string; message: string } };

/** Sends one message and calls `onEvent` for each Server-Sent Event as it arrives. */
export async function streamChat(
  body: { session_id?: string; message: string; attachment?: { kind: "bill" | "meter" | "waste"; s3_key: string } },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!API_URL) throw new ApiFailure("api_not_configured", 0, "API URL is not set");
  const token = await authClient().idToken();
  const res = await fetch(`${API_URL}/v1/chat`, {
    method: "POST",
    headers: { ...(token && { Authorization: `Bearer ${token}` }), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as Envelope<unknown> | null;
    throw new ApiFailure(json?.error?.code ?? "http_error", res.status, json?.error?.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent({ event, data: JSON.parse(data) } as ChatEvent);
    }
  }
}

export const getChatHistory = (sessionId: string) =>
  api<{ turns: { role: "user" | "assistant"; text: string }[] }>(`/v1/chat/${encodeURIComponent(sessionId)}`);
