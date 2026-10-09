/**
 * TS mirror of services/api/app/calc/tariff.py, used only for live sliders.
 * Python is canonical; both must pass packages/schemas/fixtures/tariff_cases.json.
 */
import adaniMumbai from "./data/tariffs/adani-mumbai.json";
import bescom from "./data/tariffs/bescom.json";
import bsesRajdhani from "./data/tariffs/bses-rajdhani.json";
import msedcl from "./data/tariffs/msedcl.json";
import tataPowerMumbai from "./data/tariffs/tata-power-mumbai.json";

export type Supply = "single" | "three";

export interface Slab {
  upto_units: number | null;
  energy_inr_per_kwh: number;
}

export interface FixedCharge {
  mode: "per_connection" | "by_units" | "per_kw" | "per_kw_by_load_band";
  single_phase_inr?: number;
  three_phase_inr?: number | null;
  tiers?: { upto_units: number | null; inr: number }[];
  inr_per_kw?: number;
  min_kw?: number;
  bands?: { upto_kw: number | null; inr_per_kw: number }[];
  extra_above_kw?: { above_kw: number; block_kw: number; inr_per_block: number } | null;
}

export interface BillInput {
  id: string;
  label: string;
  kind: "per_kwh" | "pct";
  base?: string[];
  default?: number;
  note?: string;
}

export interface PercentCharge {
  id: string;
  label: string;
  pct: number;
  base: string[];
  source_url?: string | null;
}

export interface Tariff {
  id: string;
  discom: string;
  name: string;
  state: string;
  category: string;
  fy: string;
  effective_from: string;
  effective_to: string;
  source: string;
  source_url: string;
  billing_cycle_days: number;
  slab_mode: "telescopic" | "whole_bill";
  slabs: Slab[];
  wheeling_inr_per_kwh?: number;
  fixed_charge: FixedCharge;
  per_kwh_adders?: { id: string; label: string; inr_per_kwh: number; source_url?: string | null }[];
  bill_inputs?: BillInput[];
  percent_charges?: PercentCharge[];
  notes?: string[];
  net_metering: {
    allowed: boolean;
    max_kw_rule: string;
    surplus: "banked_annual_settlement" | "monthly_settlement";
    note?: string;
  };
}

export const TARIFFS: Record<string, Tariff> = {
  "adani-mumbai": adaniMumbai as Tariff,
  bescom: bescom as Tariff,
  "bses-rajdhani": bsesRajdhani as Tariff,
  msedcl: msedcl as Tariff,
  "tata-power-mumbai": tataPowerMumbai as Tariff,
};

export function loadTariff(id: string): Tariff {
  const tariff = TARIFFS[id];
  if (!tariff) throw new Error(`Unknown tariff: ${id}`);
  return tariff;
}

export interface BillContext {
  supply?: Supply;
  load_kw?: number;
  inputs?: Record<string, number>;
}

export interface SlabLine {
  from_units: number;
  to_units: number | null;
  units: number;
  rate: number;
  amount: number;
}

export interface BillBreakdown {
  units: number;
  slabs: SlabLine[];
  charges: Record<string, number>;
  total: number;
}

function slabLines(units: number, tariff: Tariff): SlabLine[] {
  if (tariff.slab_mode === "whole_bill") {
    const slab = tariff.slabs.find((s) => s.upto_units === null || units <= s.upto_units);
    if (!slab) throw new Error("Tariff slabs must end with an open slab");
    const rate = slab.energy_inr_per_kwh;
    return [{ from_units: 0, to_units: slab.upto_units, units, rate, amount: units * rate }];
  }
  const lines: SlabLine[] = [];
  let lower = 0;
  for (const slab of tariff.slabs) {
    const upper = slab.upto_units;
    const inSlab = Math.max(0, (upper === null ? units : Math.min(units, upper)) - lower);
    if (inSlab > 0) {
      lines.push({
        from_units: lower,
        to_units: upper,
        units: inSlab,
        rate: slab.energy_inr_per_kwh,
        amount: inSlab * slab.energy_inr_per_kwh,
      });
    }
    if (upper === null || units <= upper) break;
    lower = upper;
  }
  return lines;
}

export function fixedCharge(units: number, tariff: Tariff, ctx: BillContext): number {
  const fc = tariff.fixed_charge;
  const loadKw = ctx.load_kw ?? 1;
  const minKw = fc.min_kw ?? 1;
  let amount: number;
  if (fc.mode === "per_kw") {
    amount = (fc.inr_per_kw ?? 0) * Math.max(loadKw, minKw);
  } else if (fc.mode === "per_kw_by_load_band") {
    const band = (fc.bands ?? []).find((b) => b.upto_kw === null || loadKw <= b.upto_kw);
    if (!band) throw new Error("Load bands must end with an open band");
    amount = band.inr_per_kw * Math.max(loadKw, minKw);
  } else if ((ctx.supply ?? "single") === "three" && fc.three_phase_inr != null) {
    amount = fc.three_phase_inr;
  } else if (fc.mode === "by_units") {
    const tier = (fc.tiers ?? []).find((t) => t.upto_units === null || units <= t.upto_units);
    if (!tier) throw new Error("Unit tiers must end with an open tier");
    amount = tier.inr;
  } else {
    amount = fc.single_phase_inr ?? 0;
  }
  const extra = fc.extra_above_kw;
  if (extra && loadKw > extra.above_kw) {
    amount += Math.ceil((loadKw - extra.above_kw) / extra.block_kw) * extra.inr_per_block;
  }
  return amount;
}

export function billBreakdown(units: number, tariff: Tariff, ctx: BillContext = {}): BillBreakdown {
  if (units < 0) throw new Error("units must be >= 0");
  const slabs = slabLines(units, tariff);
  const adders = (tariff.per_kwh_adders ?? []).reduce((sum, a) => sum + a.inr_per_kwh, 0);
  const charges: Record<string, number> = {
    fixed: fixedCharge(units, tariff, ctx),
    energy: slabs.reduce((sum, s) => sum + s.amount, 0),
    wheeling: units * (tariff.wheeling_inr_per_kwh ?? 0),
    adders: units * adders,
  };
  const sumOf = (base: string[]) => base.reduce((sum, c) => sum + (charges[c] ?? 0), 0);
  for (const bi of tariff.bill_inputs ?? []) {
    const value = ctx.inputs?.[bi.id] ?? bi.default ?? 0;
    charges[bi.id] = bi.kind === "per_kwh" ? units * value : (sumOf(bi.base ?? []) * value) / 100;
  }
  for (const pc of tariff.percent_charges ?? []) {
    charges[pc.id] = (sumOf(pc.base) * pc.pct) / 100;
  }
  const total = Object.values(charges).reduce((sum, v) => sum + v, 0);
  return { units, slabs, charges, total };
}

export function billTotal(units: number, tariff: Tariff, ctx: BillContext = {}): number {
  return billBreakdown(units, tariff, ctx).total;
}

/** ₹ saved by the last kWh not drawn from the grid, all-in. */
export function marginalRate(units: number, tariff: Tariff, ctx: BillContext = {}): number {
  if (units <= 0) return 0;
  const step = Math.min(1, units);
  return (billTotal(units, tariff, ctx) - billTotal(units - step, tariff, ctx)) / step;
}
