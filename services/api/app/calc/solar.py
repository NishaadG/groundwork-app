"""Rooftop solar sizing, cost, subsidy, savings and payback.

Pure and deterministic: irradiance is passed in (fetched and cached elsewhere),
so the same inputs always give the same report. Every step appends to `working`.
"""

import math
from typing import Literal

from pydantic import BaseModel, Field

from app.calc.tariff import BillContext, Tariff, bill_total
from app.calc.working import Source, WorkingStep
from app.data.constants import get

DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
SQFT_PER_M2 = 10.7639
MIN_SYSTEM_KW = 1.0

Shading = Literal["none", "partial", "heavy"]
LimitedBy = Literal["need", "roof", "load"]


class SolarInputs(BaseModel):
    irradiance_kwh_m2_day: list[float] = Field(min_length=12, max_length=12)
    irradiance_source: str = "NASA POWER climatology (ALLSKY_SFC_SW_DWN)"
    monthly_units: list[float] = Field(min_length=12, max_length=12)
    roof_area_sqft: float = Field(gt=0)
    shading: Shading = "none"
    sanctioned_load_kw: float | None = Field(default=None, gt=0)
    tariff: Tariff
    bill: BillContext = BillContext()
    tariff_escalation: float | None = Field(default=None, ge=0, le=0.08)
    cost_override_inr: float | None = Field(default=None, gt=0)
    size_override_kw: float | None = Field(default=None, ge=MIN_SYSTEM_KW)
    # Set for a housing society's common-area connection: the GHS/RWA subsidy applies
    # instead of the household one, capped by the number of homes
    society_homes: int | None = Field(default=None, ge=2, le=5000)
    society_kw_already_subsidised: float = Field(default=0.0, ge=0)


class SizeCandidates(BaseModel):
    by_need_kw: float
    by_roof_kw: float
    by_load_kw: float | None
    limited_by: LimitedBy


class YearRow(BaseModel):
    year: int
    savings_inr: float
    cumulative_inr: float


class SolarReport(BaseModel):
    feasible: bool
    size_kw: float
    recommended_kw: float
    candidates: SizeCandidates
    specific_yield_kwh_per_kw: list[float]
    generation_kwh: list[float]
    annual_generation_kwh: float
    consumption_kwh: list[float]
    annual_consumption_kwh: float
    cost_inr: float
    subsidy_inr: float
    net_cost_inr: float
    bill_before_inr: list[float]
    bill_after_inr: list[float]
    savings_year1_inr: float
    payback_years: float | None
    savings_25y_net_inr: float
    co2_avoided_t_per_year: float
    years: list[YearRow]
    working: list[WorkingStep]


def floor_half(x: float) -> float:
    """Round down to the nearest 0.5 (with a tolerance for float noise)."""
    return math.floor(x * 2 + 1e-9) / 2


def subsidy_inr(size_kw: float) -> float:
    s = get("pm_surya_ghar_subsidy").value
    first = min(size_kw, 2.0) * s["first_2_kw_inr_per_kw"]
    third = min(max(size_kw - 2.0, 0.0), 1.0) * s["third_kw_inr_per_kw"]
    return float(min(first + third, s["cap_inr"]))


def society_subsidy(size_kw: float, homes: int, kw_already: float = 0.0) -> tuple[float, float]:
    """(eligible kW, ₹) for a housing society's common facilities. The cap counts
    plants that residents already got a subsidy for."""
    s = get("pm_surya_ghar_ghs_subsidy").value
    cap = min(homes * s["kw_per_house"], s["cap_kw"])
    eligible = max(min(size_kw, cap - kw_already), 0.0)
    return eligible, float(eligible * s["inr_per_kw"])


def benchmark_cost_inr(size_kw: float) -> float:
    """Linear between benchmark points; the end slopes extend past either end."""
    points = [(float(p["kw"]), float(p["inr"])) for p in get("solar_cost_benchmark").value]
    if size_kw <= points[0][0]:
        (k0, c0), (k1, c1) = points[0], points[1]
    elif size_kw >= points[-1][0]:
        (k0, c0), (k1, c1) = points[-2], points[-1]
    else:
        i = next(i for i, (k, _) in enumerate(points) if k >= size_kw)
        (k0, c0), (k1, c1) = points[i - 1], points[i]
    return c0 + (c1 - c0) * (size_kw - k0) / (k1 - k0)


def specific_yield(irradiance: list[float], shading: Shading) -> list[float]:
    """kWh produced per installed kW, per month."""
    pr = get("performance_ratio").value * get("shading_factor").value[shading]
    return [h * d * pr for h, d in zip(irradiance, DAYS_IN_MONTH, strict=True)]


def net_metered_bills(
    consumption: list[float], generation: list[float], tariff: Tariff, ctx: BillContext
) -> tuple[list[float], list[float]]:
    """Monthly bills before and after solar.

    Where the DISCOM banks surplus, it carries to later months. Surplus left at
    year end, or settled monthly, is valued at ₹0 (conservative).
    """
    banking = tariff.net_metering.surplus == "banked_annual_settlement"
    before: list[float] = []
    after: list[float] = []
    bank = 0.0
    for units, gen in zip(consumption, generation, strict=True):
        before.append(bill_total(units, tariff, ctx))
        net = units - gen
        if not banking:
            net = max(net, 0.0)
        elif net >= 0:
            used = min(bank, net)
            bank -= used
            net -= used
        else:
            bank += -net
            net = 0.0
        after.append(bill_total(net, tariff, ctx))
    return before, after


def payback_from_years(years: list[YearRow], net_cost: float) -> float | None:
    prev = 0.0
    for row in years:
        if row.cumulative_inr >= net_cost:
            return row.year - 1 + (net_cost - prev) / row.savings_inr
        prev = row.cumulative_inr
    return None


def calc_solar(inp: SolarInputs) -> SolarReport:
    c = get
    working: list[WorkingStep] = []
    tariff, ctx = inp.tariff, inp.bill

    # 1–2. Specific yield per month
    pr = c("performance_ratio").value
    shade = c("shading_factor").value[inp.shading]
    yields = specific_yield(inp.irradiance_kwh_m2_day, inp.shading)
    annual_yield = sum(yields)
    working.append(
        WorkingStep(
            id="irradiance",
            label="Sunlight on your roof",
            formula="Monthly average solar irradiance at your location",
            inputs={},
            result=[round(h, 2) for h in inp.irradiance_kwh_m2_day],
            unit="kWh/m²/day",
            source=Source(
                name=inp.irradiance_source,
                url="https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
            ),
        )
    )
    working.append(
        WorkingStep(
            id="specific_yield",
            label="What 1 kW of panels makes here",
            formula="irradiance × days in month × performance ratio × shading factor",
            inputs={"performance_ratio": pr, "shading": inp.shading, "shading_factor": shade},
            result=round(annual_yield, 1),
            unit="kWh per kW per year",
            source=c("performance_ratio").as_source(),
        )
    )

    # 3. Size candidates
    annual_units = sum(inp.monthly_units)
    sqft_per_kw = c("roof_area_per_kw").value * SQFT_PER_M2
    by_need = annual_units / annual_yield if annual_yield > 0 else 0.0
    by_roof = inp.roof_area_sqft / sqft_per_kw
    by_load = inp.sanctioned_load_kw
    options: dict[LimitedBy, float] = {"need": by_need, "roof": by_roof}
    if by_load is not None:
        options["load"] = by_load
    limited_by = min(options, key=lambda k: options[k])
    feasible = by_roof >= MIN_SYSTEM_KW
    recommended = max(MIN_SYSTEM_KW, floor_half(options[limited_by])) if feasible else 0.0
    size = inp.size_override_kw if inp.size_override_kw is not None else recommended
    candidates = SizeCandidates(
        by_need_kw=round(by_need, 2),
        by_roof_kw=round(by_roof, 2),
        by_load_kw=by_load,
        limited_by=limited_by,
    )
    working.append(
        WorkingStep(
            id="size",
            label="System size",
            formula="round down to 0.5 kW of the smallest of: yearly units ÷ yield per kW, "
            "roof area ÷ area per kW, sanctioned load (min 1 kW)",
            inputs={
                "yearly_units_kwh": round(annual_units, 1),
                "by_need_kw": round(by_need, 2),
                "roof_area_sqft": inp.roof_area_sqft,
                "sqft_per_kw": round(sqft_per_kw, 1),
                "by_roof_kw": round(by_roof, 2),
                "by_load_kw": by_load,
                "limited_by": limited_by,
            },
            result=recommended,
            unit="kW",
            source=c("roof_area_per_kw").as_source(),
        )
    )

    # 4. Generation
    generation = [size * y for y in yields]
    annual_gen = sum(generation)
    working.append(
        WorkingStep(
            id="generation",
            label="Electricity your panels make in a year",
            formula="system size × yield per kW, month by month",
            inputs={"size_kw": size, "yield_kwh_per_kw": round(annual_yield, 1)},
            result=round(annual_gen, 0),
            unit="kWh/year",
        )
    )

    # 5. Cost and subsidy
    cost = inp.cost_override_inr if inp.cost_override_inr is not None else benchmark_cost_inr(size)
    if inp.society_homes is not None:
        eligible_kw, sub = society_subsidy(
            size, inp.society_homes, inp.society_kw_already_subsidised
        )
    else:
        sub = subsidy_inr(size)
    net_cost = max(cost - sub, 0.0)
    working.append(
        WorkingStep(
            id="cost",
            label="Installed cost before subsidy",
            formula="your quote"
            if inp.cost_override_inr is not None
            else "benchmark price for this size (linear between known sizes)",
            inputs={"size_kw": size},
            result=round(cost, 0),
            unit="₹",
            source=None
            if inp.cost_override_inr is not None
            else c("solar_cost_benchmark").as_source(),
        )
    )
    if inp.society_homes is not None:
        ghs = c("pm_surya_ghar_ghs_subsidy").value
        working.append(
            WorkingStep(
                id="subsidy_society",
                label="PM Surya Ghar subsidy for housing societies",
                formula=f"₹{ghs['inr_per_kw']:,}/kW, for up to {ghs['kw_per_house']} kW per home "
                f"and {ghs['cap_kw']} kW in all, less what residents already claimed",
                inputs={
                    "size_kw": size,
                    "homes": inp.society_homes,
                    "kw_already_subsidised": inp.society_kw_already_subsidised,
                    "eligible_kw": round(eligible_kw, 2),
                },
                result=round(sub, 0),
                unit="₹",
                source=c("pm_surya_ghar_ghs_subsidy").as_source(),
            )
        )
    else:
        working.append(
            WorkingStep(
                id="subsidy",
                label="PM Surya Ghar subsidy",
                formula="₹30,000/kW for the first 2 kW + ₹18,000/kW for the 3rd kW, "
                "capped at ₹78,000",
                inputs={"size_kw": size},
                result=round(sub, 0),
                unit="₹",
                source=c("pm_surya_ghar_subsidy").as_source(),
            )
        )
    working.append(
        WorkingStep(
            id="net_cost",
            label="What you pay",
            formula="installed cost − subsidy",
            inputs={"cost_inr": round(cost, 0), "subsidy_inr": round(sub, 0)},
            result=round(net_cost, 0),
            unit="₹",
        )
    )

    # 6. Year-1 savings from the slab tariff, month by month, with net metering
    before, after = net_metered_bills(inp.monthly_units, generation, tariff, ctx)
    year1 = sum(before) - sum(after)
    working.append(
        WorkingStep(
            id="savings_year1",
            label="Savings in the first year",
            formula="Σ months (bill without solar − bill with solar). Solar cuts your top "
            "slabs first; extra units are banked for later months",
            inputs={
                "bills_without_solar_inr": round(sum(before), 0),
                "bills_with_solar_inr": round(sum(after), 0),
                "tariff": f"{tariff.discom} {tariff.category} ({tariff.fy})",
            },
            result=round(year1, 0),
            unit="₹",
            source=tariff.as_source(),
        )
    )

    # 7. 25-year savings and payback
    esc = (
        inp.tariff_escalation
        if inp.tariff_escalation is not None
        else c("tariff_escalation_default").value
    )
    deg = c("panel_degradation").value
    n_years = int(c("analysis_years").value)
    years: list[YearRow] = []
    cumulative = 0.0
    for n in range(1, n_years + 1):
        s = year1 * (1 + esc) ** (n - 1) * (1 - deg) ** (n - 1)
        cumulative += s
        years.append(YearRow(year=n, savings_inr=round(s, 2), cumulative_inr=round(cumulative, 2)))
    payback = payback_from_years(years, net_cost) if year1 > 0 else None
    savings_net = cumulative - net_cost
    working.append(
        WorkingStep(
            id="payback",
            label="Payback",
            formula="year n savings = year-1 savings × (1 + price rise)^(n−1) "
            "× (1 − panel loss)^(n−1); "
            "payback is when the running total covers what you pay",
            inputs={
                "savings_year1_inr": round(year1, 0),
                "price_rise_per_year": esc,
                "panel_loss_per_year": deg,
                "net_cost_inr": round(net_cost, 0),
            },
            result=None if payback is None else round(payback, 1),
            unit="years",
            source=c("panel_degradation").as_source(),
        )
    )
    working.append(
        WorkingStep(
            id="savings_25y",
            label=f"Savings over {n_years} years, after paying for the system",
            formula=f"Σ savings for years 1–{n_years} − what you pay",
            inputs={"total_savings_inr": round(cumulative, 0), "net_cost_inr": round(net_cost, 0)},
            result=round(savings_net, 0),
            unit="₹",
            source=c("analysis_years").as_source(),
        )
    )

    # 8. CO₂
    ef = c("grid_emission_factor").value
    co2_t = annual_gen * ef / 1000
    working.append(
        WorkingStep(
            id="co2",
            label="CO₂ avoided each year",
            formula="yearly generation × grid emission factor",
            inputs={"generation_kwh": round(annual_gen, 0), "kg_co2_per_kwh": ef},
            result=round(co2_t, 2),
            unit="t CO₂/year",
            source=c("grid_emission_factor").as_source(),
        )
    )

    return SolarReport(
        feasible=feasible,
        size_kw=size,
        recommended_kw=recommended,
        candidates=candidates,
        specific_yield_kwh_per_kw=[round(y, 2) for y in yields],
        generation_kwh=[round(g, 1) for g in generation],
        annual_generation_kwh=round(annual_gen, 1),
        consumption_kwh=list(inp.monthly_units),
        annual_consumption_kwh=round(annual_units, 1),
        cost_inr=round(cost, 0),
        subsidy_inr=round(sub, 0),
        net_cost_inr=round(net_cost, 0),
        bill_before_inr=[round(b, 2) for b in before],
        bill_after_inr=[round(a, 2) for a in after],
        savings_year1_inr=round(year1, 0),
        payback_years=None if payback is None else round(payback, 2),
        savings_25y_net_inr=round(savings_net, 0),
        co2_avoided_t_per_year=round(co2_t, 3),
        years=years,
        working=working,
    )
