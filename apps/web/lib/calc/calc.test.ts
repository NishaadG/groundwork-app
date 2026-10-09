import { describe, expect, it } from "vitest";

import solarCases from "../../../../packages/schemas/fixtures/solar_cases.json";
import tariffCases from "../../../../packages/schemas/fixtures/tariff_cases.json";
import { benchmarkCostInr, calcSolar, floorHalf, subsidyInr, type SolarInputs } from "./solar";
import { type BillContext, billBreakdown, loadTariff, marginalRate } from "./tariff";

// Python rounds half-to-even and JS half-up, so rounded money may differ by 1 unit
// of the last digit. Raw tariff charges must match to floating-point precision.
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("tariff mirror matches Python fixtures", () => {
  it.each(tariffCases.map((c) => [`${c.tariff} ${c.units} units ${c.ctx.supply}`, c] as const))(
    "%s",
    (_, c) => {
      const b = billBreakdown(c.units, loadTariff(c.tariff), c.ctx as BillContext);
      for (const [key, value] of Object.entries(c.expected.charges)) {
        close(b.charges[key] ?? NaN, value, 1e-6);
      }
      close(b.total, c.expected.total, 1e-6);
    },
  );
});

describe("solar mirror matches Python fixtures", () => {
  it.each(solarCases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const { name: _name, tariff, expected, ...rest } = c;
    const r = calcSolar({ ...(rest as Omit<SolarInputs, "tariff">), tariff: loadTariff(tariff) });
    expect(r.feasible).toBe(expected.feasible);
    expect(r.size_kw).toBe(expected.size_kw);
    expect(r.recommended_kw).toBe(expected.recommended_kw);
    expect(r.candidates).toEqual(expected.candidates);
    close(r.annual_generation_kwh, expected.annual_generation_kwh, 0.1);
    close(r.cost_inr, expected.cost_inr, 1);
    expect(r.subsidy_inr).toBe(expected.subsidy_inr);
    close(r.net_cost_inr, expected.net_cost_inr, 1);
    close(r.savings_year1_inr, expected.savings_year1_inr, 1);
    close(r.savings_25y_net_inr, expected.savings_25y_net_inr, 1);
    close(r.co2_avoided_t_per_year, expected.co2_avoided_t_per_year, 0.001);
    if (expected.payback_years === null) expect(r.payback_years).toBeNull();
    else close(r.payback_years ?? NaN, expected.payback_years, 0.01);
    r.bill_after_inr.forEach((v, i) => close(v, expected.bill_after_inr[i]!, 0.01));
    r.generation_kwh.forEach((v, i) => close(v, expected.generation_kwh[i]!, 0.1));
  });
});

describe("helpers", () => {
  it("subsidy follows PM Surya Ghar slabs", () => {
    expect([1, 2, 2.5, 3, 5].map(subsidyInr)).toEqual([30000, 60000, 69000, 78000, 78000]);
  });
  it("benchmark cost interpolates and extrapolates", () => {
    expect(benchmarkCostInr(2.5)).toBeCloseTo(181000);
    expect(benchmarkCostInr(12)).toBeCloseTo(662200);
  });
  it("floors to half a kW", () => {
    expect([2.56, 2.4999999999, 0.7].map(floorHalf)).toEqual([2.5, 2.5, 0.5]);
  });
  it("marginal rate is the top slab, all-in", () => {
    expect(marginalRate(350, loadTariff("msedcl"))).toBeCloseTo((15.03 + 1.6) * 1.16, 6);
  });
});
