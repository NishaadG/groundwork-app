/**
 * TS mirror of services/api/app/calc/solar.py, used only for live sliders.
 * Python is canonical; both must pass packages/schemas/fixtures/solar_cases.json.
 * The working trace is rendered from the API's report, so it isn't mirrored here.
 */
import { CONSTANTS as C } from "./constants";
import { type BillContext, type Tariff, billTotal } from "./tariff";

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const SQFT_PER_M2 = 10.7639;
export const MIN_SYSTEM_KW = 1;

export type Shading = "none" | "partial" | "heavy";
export type LimitedBy = "need" | "roof" | "load";

export interface SolarInputs {
  irradiance_kwh_m2_day: number[];
  monthly_units: number[];
  roof_area_sqft: number;
  shading?: Shading;
  sanctioned_load_kw?: number | null;
  tariff: Tariff;
  bill?: BillContext;
  tariff_escalation?: number | null;
  cost_override_inr?: number | null;
  size_override_kw?: number | null;
}

export interface SolarResult {
  feasible: boolean;
  size_kw: number;
  recommended_kw: number;
  candidates: {
    by_need_kw: number;
    by_roof_kw: number;
    by_load_kw: number | null;
    limited_by: LimitedBy;
  };
  specific_yield_kwh_per_kw: number[];
  generation_kwh: number[];
  annual_generation_kwh: number;
  annual_consumption_kwh: number;
  cost_inr: number;
  subsidy_inr: number;
  net_cost_inr: number;
  bill_before_inr: number[];
  bill_after_inr: number[];
  savings_year1_inr: number;
  payback_years: number | null;
  savings_25y_net_inr: number;
  co2_avoided_t_per_year: number;
}

export function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

export function floorHalf(x: number): number {
  return Math.floor(x * 2 + 1e-9) / 2;
}

export function subsidyInr(sizeKw: number): number {
  const s = C.pm_surya_ghar_subsidy.value;
  const first = Math.min(sizeKw, 2) * s.first_2_kw_inr_per_kw;
  const third = Math.min(Math.max(sizeKw - 2, 0), 1) * s.third_kw_inr_per_kw;
  return Math.min(first + third, s.cap_inr);
}

export function benchmarkCostInr(sizeKw: number): number {
  const pts = C.solar_cost_benchmark.value.map((p) => [p.kw, p.inr] as const);
  let lo: readonly [number, number];
  let hi: readonly [number, number];
  if (sizeKw <= pts[0]![0]) {
    [lo, hi] = [pts[0]!, pts[1]!];
  } else if (sizeKw >= pts[pts.length - 1]![0]) {
    [lo, hi] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
  } else {
    const i = pts.findIndex(([k]) => k >= sizeKw);
    [lo, hi] = [pts[i - 1]!, pts[i]!];
  }
  return lo[1] + ((hi[1] - lo[1]) * (sizeKw - lo[0])) / (hi[0] - lo[0]);
}

export function specificYield(irradiance: number[], shading: Shading): number[] {
  const pr = C.performance_ratio.value * C.shading_factor.value[shading];
  return irradiance.map((h, i) => h * DAYS_IN_MONTH[i]! * pr);
}

export function netMeteredBills(
  consumption: number[],
  generation: number[],
  tariff: Tariff,
  ctx: BillContext,
): { before: number[]; after: number[] } {
  const banking = tariff.net_metering.surplus === "banked_annual_settlement";
  const before: number[] = [];
  const after: number[] = [];
  let bank = 0;
  consumption.forEach((units, i) => {
    before.push(billTotal(units, tariff, ctx));
    let net = units - generation[i]!;
    if (!banking) {
      net = Math.max(net, 0);
    } else if (net >= 0) {
      const used = Math.min(bank, net);
      bank -= used;
      net -= used;
    } else {
      bank += -net;
      net = 0;
    }
    after.push(billTotal(net, tariff, ctx));
  });
  return { before, after };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function calcSolar(inp: SolarInputs): SolarResult {
  if (inp.irradiance_kwh_m2_day.length !== 12 || inp.monthly_units.length !== 12) {
    throw new Error("Need 12 months of irradiance and consumption");
  }
  const shading = inp.shading ?? "none";
  const ctx = inp.bill ?? {};
  const yields = specificYield(inp.irradiance_kwh_m2_day, shading);
  const annualYield = sum(yields);

  const annualUnits = sum(inp.monthly_units);
  const sqftPerKw = C.roof_area_per_kw.value * SQFT_PER_M2;
  const byNeed = annualYield > 0 ? annualUnits / annualYield : 0;
  const byRoof = inp.roof_area_sqft / sqftPerKw;
  const byLoad = inp.sanctioned_load_kw ?? null;
  const options: [LimitedBy, number][] = [
    ["need", byNeed],
    ["roof", byRoof],
  ];
  if (byLoad !== null) options.push(["load", byLoad]);
  const [limitedBy, limit] = options.reduce((min, o) => (o[1] < min[1] ? o : min));
  const feasible = byRoof >= MIN_SYSTEM_KW;
  const recommended = feasible ? Math.max(MIN_SYSTEM_KW, floorHalf(limit)) : 0;
  const size = inp.size_override_kw ?? recommended;

  const generation = yields.map((y) => size * y);
  const annualGen = sum(generation);

  const cost = inp.cost_override_inr ?? benchmarkCostInr(size);
  const subsidy = subsidyInr(size);
  const netCost = Math.max(cost - subsidy, 0);

  const { before, after } = netMeteredBills(inp.monthly_units, generation, inp.tariff, ctx);
  const year1 = sum(before) - sum(after);

  const esc = inp.tariff_escalation ?? C.tariff_escalation_default.value;
  const deg = C.panel_degradation.value;
  const nYears = C.analysis_years.value;
  let cumulative = 0;
  let prev = 0;
  let payback: number | null = null;
  for (let n = 1; n <= nYears; n++) {
    const s = year1 * (1 + esc) ** (n - 1) * (1 - deg) ** (n - 1);
    cumulative += s;
    if (payback === null && year1 > 0 && roundTo(cumulative, 2) >= netCost) {
      payback = n - 1 + (netCost - prev) / roundTo(s, 2);
    }
    prev = roundTo(cumulative, 2);
  }

  return {
    feasible,
    size_kw: size,
    recommended_kw: recommended,
    candidates: {
      by_need_kw: roundTo(byNeed, 2),
      by_roof_kw: roundTo(byRoof, 2),
      by_load_kw: byLoad,
      limited_by: limitedBy,
    },
    specific_yield_kwh_per_kw: yields.map((y) => roundTo(y, 2)),
    generation_kwh: generation.map((g) => roundTo(g, 1)),
    annual_generation_kwh: roundTo(annualGen, 1),
    annual_consumption_kwh: roundTo(annualUnits, 1),
    cost_inr: roundTo(cost, 0),
    subsidy_inr: roundTo(subsidy, 0),
    net_cost_inr: roundTo(netCost, 0),
    bill_before_inr: before.map((b) => roundTo(b, 2)),
    bill_after_inr: after.map((a) => roundTo(a, 2)),
    savings_year1_inr: roundTo(year1, 0),
    payback_years: payback === null ? null : roundTo(payback, 2),
    savings_25y_net_inr: roundTo(cumulative - netCost, 0),
    co2_avoided_t_per_year: roundTo((annualGen * C.grid_emission_factor.value) / 1000, 3),
  };
}
