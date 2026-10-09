import type { Page, Route } from "@playwright/test";

import msedcl from "../lib/calc/data/tariffs/msedcl.json";
import sample from "../lib/calc/data/sample_household.json";
import wasteData from "../lib/calc/data/waste.json";

/**
 * A stand-in for the Groundwork API (same routes, same envelope) for browser tests.
 * The real API and its JWT checks are covered by pytest against mocked AWS.
 * Mock auth sends "Bearer mock.<sub>".
 */
export const API = "http://api.test";

type Store = Map<string, Record<string, unknown>>;

const PROFILE_FIELDS = new Set([
  "name", "lang", "home_type", "city", "state", "lat", "lng", "roof_area_sqft", "shading",
  "household_size", "discom", "supply", "sanctioned_load_kw", "approx_monthly_bill_inr",
  "water_source", "tank_litres", "water_inr_per_kl", "tanker_litres", "inr_per_tanker",
  "onboarding_step", "onboarding_done", "leak_reminders",
]);

function json(route: Route, status: number, data: unknown, error: unknown = null) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ data, error }),
  });
}

export async function installFakeApi(
  page: Page,
  store: Store = new Map(),
  { extractMode = "ok", allowTiles = false }: { extractMode?: "ok" | "fail"; allowTiles?: boolean } = {},
) {
  const bills: unknown[] = [];
  let installed: { report_id: string; installed_on: string; size_kw: number } | null = null;
  const water = {
    readings: [] as { id: string; at: string; kind: string; value: number; source: string }[],
    check: null as null | { id: string; kind: "meter" | "tank"; night_at: string; value: number },
    events: [] as { id: string; type: "leak"; status: "open" | "fixed"; litres_per_day: number; detected_at: string; fixed_at: string | null; working: unknown }[],
  };
  const waste = {
    scans: [] as Record<string, unknown>[],
    applications: [] as Record<string, unknown>[],
    pickups: [] as Record<string, unknown>[],
  };
  type Member = { sub: string; flat_label: string | null; nickname: string | null; leaderboard_opt_in: boolean };
  const societies = new Map<string, { id: string; name: string; city: string; flats: number; code: string; admin: string; members: Member[]; announcements: { id: string; text: string; at: string }[]; tanks: { name: string; level_pct: number; at: string; history: { at: string; level_pct: number }[] }[]; common_solar?: unknown }>();
  const memberOf = new Map<string, string>();
  const chats = new Map<string, { role: string; text: string }[]>();
  const societyView = (sub: string) => {
    const s = societies.get(memberOf.get(sub)!)!;
    const pct = Math.round((s.members.length / s.flats) * 1000) / 10;
    const me = s.members.find((m) => m.sub === sub)!;
    return {
      id: s.id, name: s.name, city: s.city, flats: s.flats, invite_code: s.code, is_admin: s.admin === sub,
      members: s.members.length, participation_pct: pct,
      totals: { projected: {}, realised: s.members.length > 1 ? { kg: 5 } : {} },
      leaks: { found: 0, fixed: 0 },
      leaderboard: s.members.filter((m) => m.leaderboard_opt_in).map((m) => ({ name: m.nickname || m.flat_label || "A household", is_you: m.sub === sub, change_pct: null, grade: null })),
      leaderboard_hidden: s.members.filter((m) => !m.leaderboard_opt_in).length,
      me: { flat_label: me.flat_label, nickname: me.nickname, leaderboard_opt_in: me.leaderboard_opt_in },
      tanks: s.tanks, announcements: s.announcements, common_solar: s.common_solar ?? null,
      working: [{ id: "society_participation", label: "Participation", formula: "households ÷ flats × 100", inputs: { households: s.members.length, flats: s.flats }, result: pct, unit: "%", source: null }],
    };
  };
  const member = (sub: string, b: Partial<Member>): Member => ({ sub, flat_label: b.flat_label || null, nickname: b.nickname || null, leaderboard_opt_in: Boolean(b.leaderboard_opt_in) });
  const reports = new Map<string, { id: string; created_at: string; report: typeof sample.report } & Record<string, unknown>>();
  await page.route("http://s3.test/**", (route) => route.fulfill({ status: 204 }));
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "GET,POST,PUT,DELETE",
        },
      });
    }
    if (req.url() === `${API}/v1/public/partners` && req.method() === "POST") {
      const body = req.postDataJSON() as { name: string; phone: string; materials: string[] };
      if (!body.materials?.length || !/^\+?[0-9 ]{8,16}$/.test(body.phone)) {
        return json(route, 422, null, { code: "validation_failed", message: "Invalid" });
      }
      waste.applications.push(body);
      return json(route, 200, { id: `pa${waste.applications.length}`, status: "pending" });
    }
    const auth = req.headers()["authorization"] ?? "";
    const sub = auth.startsWith("Bearer mock.") ? auth.slice("Bearer mock.".length) : null;
    if (!sub) return json(route, 401, null, { code: "not_signed_in", message: "Sign in to continue." });
    const path = new URL(req.url()).pathname;
    const now = new Date().toISOString();

    if (path === "/v1/me" && req.method() === "GET") {
      const p = store.get(sub);
      return json(route, 200, p ?? { email: `${sub}@example.com`, onboarding_step: 0, onboarding_done: false });
    }
    if (path === "/v1/me" && req.method() === "PUT") {
      const body = req.postDataJSON() as Record<string, unknown>;
      if (Object.keys(body).some((k) => !PROFILE_FIELDS.has(k))) {
        return json(route, 422, null, { code: "validation_failed", message: "Invalid" });
      }
      const p = { ...(store.get(sub) ?? { created_at: now }), updated_at: now } as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (v === null) delete p[k];
        else p[k] = v;
      }
      store.set(sub, p);
      return json(route, 200, p);
    }
    if (path === "/v1/uploads/presign") {
      const body = req.postDataJSON() as { kind: string; content_type: string };
      return json(route, 200, {
        url: "http://s3.test/upload",
        fields: { key: `uploads/${sub}/${body.kind}/x.jpg`, "Content-Type": body.content_type },
        key: `uploads/${sub}/${body.kind}/x.jpg`,
        expires_in: 300,
        max_bytes: 10485760,
      });
    }
    if (path === "/v1/bills/extract") {
      if (extractMode === "fail") return json(route, 502, null, { code: "extraction_failed", message: "x" });
      const f = (value: unknown, confidence = "high", evidence: string | null = null, issue: string | null = null) => ({ value, confidence, evidence, issue });
      return json(route, 200, {
        discom_id: "msedcl",
        consumer_name_masked: "P•••a K••••••i",
        history: [{ month: "2026-07", units: 295 }],
        fields: {
          discom: f("MAHAVITARAN"),
          units_consumed_kwh: f(280, "high", "Units Consumed 280"),
          billing_period_start: f("2026-08-01"),
          billing_period_end: f("2026-08-31"),
          total_amount_inr: f(9000, "low", "Rs. 9,000.00", "amount_vs_tariff"),
          sanctioned_load_kw: f(3),
          supply_phase: f("single"),
          fac_amount_inr: f(84),
        },
      });
    }
    if (path === "/v1/bills" && req.method() === "POST") {
      bills.push(req.postDataJSON());
      return json(route, 200, { id: `bill${bills.length}`, ...req.postDataJSON() });
    }
    if (path === "/v1/solar/reports" && req.method() === "POST") {
      const body = req.postDataJSON() as { roof: { lat: number; lng: number; roof_area_sqft: number; shading: string } };
      const id = `r${reports.size + 1}`;
      reports.set(id, {
        id,
        bill_id: "bill1",
        discom: "msedcl",
        created_at: now,
        report: sample.report,
        working: sample.report.working,
        bill_check: { computed_total: 3384.88, billed_total: 3385, diff_pct: 0, matches: true },
        inputs: {
          irradiance_kwh_m2_day: sample.inputs.irradiance_kwh_m2_day,
          irradiance_source: "NASA POWER",
          monthly_units: sample.inputs.monthly_units,
          months_from_data: 1,
          roof: body.roof,
          bill_context: { supply: "single", load_kw: 3, inputs: {} },
          scenario: {},
          tariff: msedcl,
        },
      });
      return json(route, 200, reports.get(id));
    }
    if (path === "/v1/solar/reports" && req.method() === "GET") {
      return json(route, 200, [...reports.values()].map((r) => ({
        id: r.id, created_at: r.created_at, discom: "msedcl", size_kw: r.report.size_kw,
        net_cost_inr: r.report.net_cost_inr, savings_year1_inr: r.report.savings_year1_inr,
        payback_years: r.report.payback_years, feasible: true,
      })));
    }
    if (/^\/v1\/solar\/reports\/[^/]+\/tips$/.test(path)) {
      return json(route, 200, {
        tips: [
          { title: "Put the geyser on a timer", body: "It stops heating water you won't use. Most of your bill sits in your top slab." },
          { title: "Set the AC a little warmer", body: "Each degree warmer cuts what it draws through the day." },
          { title: "Switch off standby power", body: "TVs and set-top boxes draw power all day. A switched socket ends that." },
        ],
        rupees_per_unit_cut: 14.38,
        top_slab: "101 to 300 units",
        generated_by: "test",
      });
    }
    const reportMatch = path.match(/^\/v1\/solar\/reports\/([^/]+)(\/share)?$/);
    if (reportMatch) {
      const r = reports.get(reportMatch[1]!);
      if (!r) return json(route, 404, null, { code: "report_not_found", message: "x" });
      if (reportMatch[2]) return json(route, 200, { token: "tok123", expires_at: now });
      return json(route, 200, r);
    }
    if (/^\/v1\/solar\/reports\/[^/]+\/installed$/.test(path)) {
      const id = path.split("/")[4]!;
      installed = { report_id: id, installed_on: (req.postDataJSON() as { installed_on: string }).installed_on, size_kw: sample.report.size_kw };
      return json(route, 200, { report_id: id, installed_on: installed.installed_on });
    }
    if (path === "/v1/solar/installed" && req.method() === "DELETE") {
      installed = null;
      return json(route, 200, { installed: null });
    }
    if (path === "/v1/home") {
      const latest = [...reports.values()].at(-1);
      const r = sample.report;
      const projected = latest && !installed ? { inr: r.savings_year1_inr, kwh: r.annual_generation_kwh, co2_t: r.co2_avoided_t_per_year } : {};
      const estimated = installed ? { inr: 5934, kwh: 481, co2_t: 0.342 } : {};
      return json(route, 200, {
        ledger: { projected, estimated, measured: {}, this_month: installed ? { inr: 2967, kwh: 240, co2_t: 0.171 } : {}, entries: latest ? 3 : 0, series: {} },
        ledger_working: installed
          ? [{ id: "ledger_inr", label: "Money saved", formula: "realised = estimated entries + measured entries", inputs: { estimated_total: 5934, measured_total: 0 }, result: 5934, unit: "₹", source: { name: "Your solar report and your ledger", url: null, as_of: null, status: null } }]
          : [],
        report_card: { energy: null },
        next_action: !bills.length
          ? { kind: "upload_bill", href: "/app/solar/new" }
          : installed
            ? { kind: "log_bill", href: "/app/solar/new" }
            : { kind: "get_quotes", kw: r.size_kw, href: `/app/solar/${latest?.id}` },
        bills: [],
        activity: latest ? [{ type: "solar_report", at: now, id: latest.id, size_kw: r.size_kw, feasible: true }] : [],
        installed,
      });
    }
    if (path === "/v1/water/summary") {
      const series = water.readings.length >= 2 ? [{ day: now.slice(0, 10), litres: 620 }] : [];
      return json(route, 200, {
        kind: water.readings[0]?.kind ?? null,
        series,
        litres_per_day: series.length ? 620 : null,
        lpcd: series.length ? { lpcd: 155, benchmark: 135, ratio: 1.15, working: { id: "lpcd", label: "Water per person per day", formula: "average litres a day ÷ people in your home", inputs: {}, result: 155, unit: "litres per person per day", source: null } } : null,
        anomalies: [],
        tank: null,
        forecast: null,
        events: water.events,
        open_check: water.check ? { id: water.check.id, kind: water.check.kind, night_at: water.check.night_at } : null,
        latest: water.readings.slice(-10).reverse(),
        stream: null,
      });
    }
    if (path === "/v1/water/readings" || path === "/v1/water/leak-check") {
      const body = req.postDataJSON() as { kind: "meter" | "tank"; value: number; at?: string };
      const at = body.at ?? now;
      water.readings.push({ id: `w${water.readings.length}`, at, kind: body.kind, value: body.value, source: "manual" });
      if (path === "/v1/water/leak-check") {
        water.check = { id: "c1", kind: body.kind, night_at: at, value: body.value };
        return json(route, 200, { id: "c1", night_at: at, kind: body.kind });
      }
      return json(route, 200, { id: `w${water.readings.length - 1}`, at, kind: body.kind, value: body.value, source: "manual" });
    }
    if (/^\/v1\/water\/leak-check\/[^/]+\/finish$/.test(path)) {
      const body = req.postDataJSON() as { value: number; at?: string };
      const c = water.check!;
      const moved = body.value - c.value;
      const leak = moved > 5;
      const perDay = leak ? Math.round((moved * 24) / 8) : 0;
      const working = { id: "leak_check", label: "Overnight leak check", formula: "water that moved while nobody used any", inputs: { litres_in_window: moved }, result: perDay, unit: "litres a day", source: null };
      water.readings.push({ id: `w${water.readings.length}`, at: body.at ?? now, kind: c.kind, value: body.value, source: "manual" });
      water.check = null;
      let eventId: string | null = null;
      if (leak) {
        eventId = "e1";
        water.events.unshift({ id: eventId, type: "leak", status: "open", litres_per_day: perDay, detected_at: body.at ?? now, fixed_at: null, working });
      }
      return json(route, 200, { leak, result: { litres_per_day: perDay, window_litres: moved, working }, event_id: eventId });
    }
    if (/^\/v1\/water\/events\/[^/]+\/fixed$/.test(path)) {
      const e = water.events.find((x) => path.includes(x.id));
      if (e) {
        e.status = "fixed";
        e.fixed_at = now;
      }
      return json(route, 200, { id: e?.id, fixed_at: now });
    }
    if (path === "/v1/water/devices") {
      return json(route, 200, { id: "d1", name: "Smart meter", key: "gwd_testkey123" });
    }
    if (path === "/v1/waste/scan") {
      return json(route, 200, {
        items: [
          { label: "PET water bottles", material: "pet", stream: "dry", recyclable: true, tip: "Rinse and crush them.", confidence: "high" },
          { label: "Chips packets", material: "multilayer", stream: "dry", recyclable: false, tip: "Keep them dry; they go in dry waste.", confidence: "low" },
        ],
      });
    }
    if (path === "/v1/waste/scans" && req.method() === "POST") {
      // Same arithmetic as services/api/app/calc/waste.py, enough for the browser tests
      const body = req.postDataJSON() as { items: { material: string; label?: string; kg?: number; size?: "handful" | "bag" | "sack" }[] };
      const mats = Object.fromEntries(wasteData.materials.map((m) => [m.id, m]));
      if (body.items.some((i) => i.kg === undefined && !i.size)) return json(route, 422, null, { code: "weight_needed", message: "x" });
      const items = body.items.map((i) => {
        const m = mats[i.material];
        const kg = i.kg ?? wasteData.size_presets_kg[i.size!];
        return {
          material: i.material,
          label: i.label ?? m.label,
          stream: m.stream,
          kg,
          inr_min: m.rate_inr_per_kg ? kg * m.rate_inr_per_kg.min : null,
          inr_max: m.rate_inr_per_kg ? kg * m.rate_inr_per_kg.max : null,
          co2_kg: m.co2 ? kg * m.co2.kg_co2e_avoided_per_kg : null,
          size: i.size ?? null,
        };
      });
      const sum = (f: (i: (typeof items)[number]) => number) => Math.round(items.reduce((a, i) => a + f(i), 0) * 1000) / 1000;
      const scan = {
        id: `ws${waste.scans.length + 1}`,
        at: now,
        items,
        kg_total: sum((i) => i.kg),
        kg_diverted: sum((i) => (mats[i.material].recyclable || i.material === "wet" ? i.kg : 0)),
        inr_min: Math.round(sum((i) => i.inr_min ?? 0)),
        inr_max: Math.round(sum((i) => i.inr_max ?? 0)),
        co2_t: sum((i) => i.co2_kg ?? 0) / 1000,
        working: [
          { id: "scrap_value", label: "Indicative scrap value", formula: "Σ kg × rate", inputs: {}, result: sum((i) => i.inr_max ?? 0), unit: "₹", source: wasteData.rates_source },
        ],
      };
      waste.scans.unshift(scan);
      return json(route, 200, scan);
    }
    const wasteDel = path.match(/^\/v1\/waste\/scans\/([^/]+)$/);
    if (wasteDel && req.method() === "DELETE") {
      waste.scans = waste.scans.filter((x) => x.id !== wasteDel[1]);
      return json(route, 200, { deleted: wasteDel[1] });
    }
    if (path === "/v1/waste/summary") {
      const byStream: Record<string, number> = {};
      let diverted = 0;
      const seen = new Set<string>();
      for (const sc of waste.scans) {
        diverted += sc.kg_diverted as number;
        for (const i of sc.items as { stream: string; kg: number; material: string }[]) {
          byStream[i.stream] = (byStream[i.stream] ?? 0) + i.kg;
          seen.add(i.material);
        }
      }
      const total = Object.values(byStream).reduce((a, b) => a + b, 0);
      const tip = ["multilayer", "cardboard", "ldpe_film", "glass", "ewaste", "special_care"].find((m) => seen.has(m)) ?? null;
      return json(route, 200, { scans: waste.scans, week: { kg_by_stream: byStream, kg_total: total, kg_diverted: diverted, tip } });
    }
    if (path === "/v1/waste/partners") {
      return json(route, 200, [
        { id: "p1", name: "Aundh Scrap Traders", area: "Aundh", city: "Pune", materials: ["newspaper", "pet"], phone: "+91 90000 00001", is_demo: true },
      ]);
    }
    if (path === "/v1/waste/pickups") {
      const body = req.postDataJSON() as { partner_id: string; scan_id: string; preferred_date: string };
      waste.pickups.push(body);
      return json(route, 200, {
        id: `pk${waste.pickups.length}`,
        ...body,
        status: "requested",
        emailed: false,
        partner: { name: "Aundh Scrap Traders", phone: "+91 90000 00001", is_demo: true },
      });
    }
    if (path === "/v1/society" && req.method() === "GET") return json(route, 200, memberOf.has(sub) ? societyView(sub) : null);
    if (path === "/v1/society" && req.method() === "POST") {
      const b = req.postDataJSON() as { name: string; city: string; flats: number } & Partial<Member>;
      const id = `s${societies.size + 1}`;
      societies.set(id, { id, name: b.name, city: b.city, flats: b.flats, code: "GRNA4CRE", admin: sub, members: [member(sub, b)], announcements: [], tanks: [] });
      memberOf.set(sub, id);
      return json(route, 200, societyView(sub));
    }
    if (path === "/v1/society/join") {
      const b = req.postDataJSON() as { code: string } & Partial<Member>;
      const s = [...societies.values()].find((x) => x.code === b.code);
      if (!s) return json(route, 404, null, { code: "invite_not_found", message: "x" });
      s.members.push(member(sub, b));
      memberOf.set(sub, s.id);
      return json(route, 200, societyView(sub));
    }
    if (path === "/v1/society/me" && req.method() === "PUT") {
      const s = societies.get(memberOf.get(sub)!)!;
      const m = s.members.find((x) => x.sub === sub)!;
      Object.assign(m, req.postDataJSON());
      return json(route, 200, societyView(sub));
    }
    if (path === "/v1/society/me" && req.method() === "DELETE") {
      const s = societies.get(memberOf.get(sub)!)!;
      s.members = s.members.filter((x) => x.sub !== sub);
      memberOf.delete(sub);
      if (s.admin === sub && s.members[0]) s.admin = s.members[0].sub;
      return json(route, 200, { left: true });
    }
    if (path === "/v1/society/announcements") {
      const s = societies.get(memberOf.get(sub)!)!;
      if (s.admin !== sub) return json(route, 403, null, { code: "not_admin", message: "x" });
      s.announcements.unshift({ id: `a${s.announcements.length + 1}`, text: (req.postDataJSON() as { text: string }).text, at: now });
      return json(route, 200, { announcements: s.announcements });
    }
    if (path === "/v1/society/solar") {
      const s = societies.get(memberOf.get(sub)!)!;
      if (s.admin !== sub) return json(route, 403, null, { code: "not_admin", message: "x" });
      if (store.get(sub)?.lat == null) return json(route, 422, null, { code: "location_needed", message: "x" });
      const b = req.postDataJSON() as { sanctioned_load_kw: number; monthly_units: number; terrace_area_sqft: number; discom: string };
      // Simplified stand-in for the real calculation (tested in the API suite)
      const size = Math.min(b.sanctioned_load_kw, Math.floor((b.terrace_area_sqft / 107.6) * 2) / 2);
      const cost = size * 50_000;
      const subsidy = Math.min(size, s.flats * 3) * 18_000;
      const saved = Math.round(size * 1400 * 9);
      s.common_solar = {
        inputs: b,
        result: {
          feasible: size >= 1, size_kw: size, annual_generation_kwh: size * 1400, cost_inr: cost, subsidy_inr: subsidy,
          net_cost_inr: cost - subsidy, savings_year1_inr: saved, payback_years: Math.round(((cost - subsidy) / saved) * 10) / 10,
          savings_25y_net_inr: saved * 25 - (cost - subsidy), co2_avoided_t_per_year: 1, homes: s.flats,
          per_home: { net_cost_inr: Math.round((cost - subsidy) / s.flats), savings_year1_inr: Math.round(saved / s.flats) },
          tariff: "MSEDCL LT-I(B) Residential",
        },
        working: [{ id: "subsidy_society", label: "PM Surya Ghar subsidy for housing societies", formula: "x", inputs: { size_kw: size, homes: s.flats }, result: subsidy, unit: "₹", source: null }],
        updated_at: now,
      };
      return json(route, 200, societyView(sub));
    }
    if (path === "/v1/society/tanks") {
      const s = societies.get(memberOf.get(sub)!)!;
      const b = req.postDataJSON() as { name: string; level_pct: number };
      s.tanks = [{ name: b.name, level_pct: b.level_pct, at: now, history: [] }, ...s.tanks.filter((x) => x.name !== b.name)];
      return json(route, 200, { tanks: s.tanks });
    }
    if (path === "/v1/reports") {
      const kg = waste.scans.reduce((a, x) => a + (x.kg_total as number), 0);
      const diverted = waste.scans.reduce((a, x) => a + (x.kg_diverted as number), 0);
      return json(route, 200, {
        solar_reports: [...reports.values()].map((r) => ({
          id: r.id, created_at: r.created_at, discom: "msedcl", size_kw: r.report.size_kw, net_cost_inr: r.report.net_cost_inr,
          savings_year1_inr: r.report.savings_year1_inr, payback_years: r.report.payback_years, feasible: r.report.feasible,
        })),
        cards: [],
        impact: {
          name: (store.get(sub)?.name as string) ?? null, city: (store.get(sub)?.city as string) ?? null,
          generated_at: now, since: waste.scans.length ? (waste.scans.at(-1)!.at as string) : null,
          ledger: { projected: {}, estimated: {}, measured: diverted ? { kg: diverted } : {} },
          working: diverted ? [{ id: "ledger_kg", label: "Waste kept out of landfill", formula: "realised = estimated entries + measured entries", inputs: { waste_scan_measured: diverted }, result: diverted, unit: "kg", source: { name: "Your ledger entries" } }] : [],
          activity: { bills: bills.length, solar_reports: reports.size, installed: null, leaks_found: water.events.length, leaks_fixed: water.events.filter((e) => e.status === "fixed").length, waste_scans: waste.scans.length, waste_kg: kg, waste_kg_diverted: diverted },
          sources: [{ label: "Grid emission factor (India, weighted average)", source: "CEA CO2 Baseline Database v21", url: "https://cea.nic.in/", as_of: "2026-10-01", status: "verified" }],
        },
      });
    }
    if (path === "/v1/chat" && req.method() === "POST") {
      const b = req.postDataJSON() as { session_id?: string; message: string; attachment?: { kind: string; s3_key: string } };
      if (b.attachment && !b.attachment.s3_key.startsWith(`uploads/${sub}/`)) return json(route, 404, null, { code: "upload_not_found", message: "x" });
      const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      const sid = b.session_id ?? "fakesession1";
      const out: string[] = [];
      const say = (text: string) => text.match(/[\s\S]{1,10}/g)!.forEach((c) => out.push(sse("token", { text: c })));
      if (b.attachment?.kind === "waste") {
        out.push(sse("tool_start", { name: "waste_agent" }), sse("tool_start", { name: "classify_attached_photo" }));
        out.push(sse("card", { type: "waste_items", data: { items: [{ label: "PET water bottles", material: "pet", stream: "dry", recyclable: true, tip: "Rinse them.", confidence: "high" }] } }));
        say("I can see PET water bottles. They go in dry waste.");
      } else if (/water/i.test(b.message)) {
        out.push(sse("tool_start", { name: "water_agent" }), sse("tool_start", { name: "get_water_summary" }));
        out.push(sse("card", { type: "leak_alert", data: { litres_per_day: 120, detected_at: now } }));
        say("Your overnight check found about 120 litres a day going somewhere. Start with the toilet cistern.");
      } else if (/fail/i.test(b.message)) {
        out.push(sse("error", { code: "copilot_failed", message: "Something went wrong. Try again." }));
        return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: out.join("") });
      } else {
        out.push(sse("tool_start", { name: "get_ledger" }));
        out.push(sse("card", { type: "ledger_snapshot", data: { realised: { kg: 5, co2_t: 0.01 }, projected: {} } }));
        say("You've kept 5 kg of waste out of landfill so far.");
      }
      out.push(sse("done", { session_id: sid, agents: [], tools: [] }));
      chats.set(sid, [...(chats.get(sid) ?? []), { role: "user", text: b.message }, { role: "assistant", text: "(reply)" }]);
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" }, body: out.join("") });
    }
    const chatGet = path.match(/^\/v1\/chat\/([a-z0-9]+)$/);
    if (chatGet) return json(route, 200, { turns: chats.get(chatGet[1]) ?? [] });
    if (path === "/v1/ledger") {
      const has = reports.size > 0;
      return json(route, 200, {
        projected: has ? { inr: sample.report.savings_year1_inr, kwh: sample.report.annual_generation_kwh, co2_t: sample.report.co2_avoided_t_per_year } : {},
        measured: {},
        entries: has ? 3 : 0,
      });
    }
    if (path === "/v1/me/export") {
      const p = store.get(sub);
      return json(route, 200, { exported_at: now, items: p ? [{ SK: "PROFILE", ...p }] : [] });
    }
    if (path === "/v1/me" && req.method() === "DELETE") {
      const had = store.delete(sub);
      return json(route, 200, { deleted_items: had ? 1 : 0, deleted_files: 0 });
    }
    return json(route, 404, null, { code: "not_found", message: "Not Found" });
  });

  // Place search (Nominatim) and map tiles stay offline in tests
  await page.route("https://nominatim.openstreetmap.org/**", (route) => {
    const url = new URL(route.request().url());
    const pune = {
      lat: "18.5204", lon: "73.8567", display_name: "Pune, Pune District, Maharashtra, India",
      address: { city: "Pune", state: "Maharashtra" },
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(url.pathname.includes("reverse") ? pune : [pune]),
    });
  });
  if (!allowTiles) await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  return store;
}
