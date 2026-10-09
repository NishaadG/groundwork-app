import pytest

from app.calc.solar import (
    DAYS_IN_MONTH,
    SolarInputs,
    benchmark_cost_inr,
    calc_solar,
    floor_half,
    subsidy_inr,
)
from app.calc.tariff import load_tariff

MSEDCL = load_tariff("msedcl")
FLAT_SUN = [5.0] * 12
PUNE_SUN = [
    4.9891,
    5.8502,
    6.6137,
    7.0778,
    7.0174,
    4.5682,
    3.3101,
    3.3838,
    4.3092,
    5.0119,
    4.896,
    4.6649,
]


def msedcl_bill(units: float) -> float:
    slabs = [(100, 3.96), (300, 10.80), (500, 15.03), (float("inf"), 17.53)]
    energy, lower = 0.0, 0.0
    for upper, rate in slabs:
        energy += max(0.0, min(units, upper) - lower) * rate
        lower = upper
    return (130 + energy + units * 1.60) * 1.16


def inputs(**kw: object) -> SolarInputs:
    base: dict[str, object] = {
        "irradiance_kwh_m2_day": FLAT_SUN,
        "monthly_units": [300.0] * 12,
        "roof_area_sqft": 400,
        "shading": "none",
        "sanctioned_load_kw": 3,
        "tariff": MSEDCL,
    }
    base.update(kw)
    return SolarInputs.model_validate(base)


@pytest.mark.parametrize(
    ("kw", "expected"),
    [(1, 30000), (1.5, 45000), (2, 60000), (2.5, 69000), (3, 78000), (5, 78000), (0.5, 15000)],
)
def test_subsidy(kw: float, expected: float) -> None:
    assert subsidy_inr(kw) == expected


@pytest.mark.parametrize(
    ("kw", "expected"),
    [(1, 80000), (2, 160000), (2.5, 181000), (3, 202000), (7.5, 452500), (12, 662200)],
)
def test_benchmark_cost(kw: float, expected: float) -> None:
    assert benchmark_cost_inr(kw) == pytest.approx(expected)


def test_floor_half() -> None:
    assert [floor_half(x) for x in (2.56, 2.5, 2.4999999999, 3.99, 0.7)] == [
        2.5,
        2.5,
        2.5,
        3.5,
        0.5,
    ]


def test_report_matches_hand_calculation() -> None:
    r = calc_solar(inputs())

    # Yield: 5 kWh/m²/day × 365 × 0.77 = 1405.25 kWh/kW/yr
    assert sum(r.specific_yield_kwh_per_kw) == pytest.approx(1405.25, abs=0.05)
    # by_need 3600/1405.25 = 2.56, by_roof 400/107.639 = 3.72, by_load 3 → need, 2.5 kW
    assert r.candidates.limited_by == "need"
    assert r.candidates.by_need_kw == pytest.approx(2.56, abs=0.01)
    assert r.candidates.by_roof_kw == pytest.approx(3.72, abs=0.01)
    assert r.size_kw == r.recommended_kw == 2.5
    assert r.annual_generation_kwh == pytest.approx(2.5 * 1405.25, abs=0.5)

    assert r.cost_inr == 181000
    assert r.subsidy_inr == 69000
    assert r.net_cost_inr == 112000

    # Generation never exceeds 300 units in a month here, so nothing is banked.
    gen = [2.5 * 5.0 * d * 0.77 for d in DAYS_IN_MONTH]
    expected_year1 = sum(msedcl_bill(300) - msedcl_bill(300 - g) for g in gen)
    assert r.savings_year1_inr == pytest.approx(expected_year1, abs=1)

    # Payback by hand
    cum, prev, payback = 0.0, 0.0, None
    for n in range(1, 26):
        s = expected_year1 * 1.03 ** (n - 1) * 0.994 ** (n - 1)
        cum += s
        if payback is None and cum >= 112000:
            payback = n - 1 + (112000 - prev) / s
        prev = cum
    assert payback is not None
    assert r.payback_years == pytest.approx(payback, abs=0.01)
    assert r.savings_25y_net_inr == pytest.approx(cum - 112000, abs=1)

    assert r.co2_avoided_t_per_year == pytest.approx(2.5 * 1405.25 * 0.71 / 1000, abs=0.001)

    ids = [w.id for w in r.working]
    assert ids == [
        "irradiance",
        "specific_yield",
        "size",
        "generation",
        "cost",
        "subsidy",
        "net_cost",
        "savings_year1",
        "payback",
        "savings_25y",
        "co2",
    ]


def test_roof_limits_size() -> None:
    r = calc_solar(inputs(roof_area_sqft=200, sanctioned_load_kw=None))
    assert r.candidates.limited_by == "roof"
    assert r.size_kw == 1.5  # 200 / 107.6 = 1.86 → 1.5


def test_load_limits_size() -> None:
    r = calc_solar(inputs(monthly_units=[600.0] * 12, roof_area_sqft=1000, sanctioned_load_kw=2))
    assert r.candidates.limited_by == "load"
    assert r.size_kw == 2


def test_tiny_roof_is_not_feasible() -> None:
    r = calc_solar(inputs(roof_area_sqft=80))
    assert not r.feasible
    assert r.size_kw == 0
    assert r.payback_years is None


def test_small_consumer_still_gets_minimum_size() -> None:
    r = calc_solar(inputs(monthly_units=[60.0] * 12))
    assert r.size_kw == 1.0


def test_surplus_is_banked_into_later_months() -> None:
    # Low winter use, solar surplus in the sunny months covers later ones.
    units = [100.0] * 6 + [250.0] * 6
    r = calc_solar(inputs(irradiance_kwh_m2_day=PUNE_SUN, monthly_units=units, size_override_kw=2))
    # Without banking every month would pay at least the fixed charge plus duty
    # on any net draw; with banking some later months net to 0 units.
    assert min(r.bill_after_inr) == pytest.approx(130 * 1.16, abs=0.01)
    assert r.savings_year1_inr > 0


def test_overrides() -> None:
    r = calc_solar(inputs(size_override_kw=3, cost_override_inr=150000, tariff_escalation=0))
    assert r.size_kw == 3 and r.recommended_kw == 2.5
    assert r.net_cost_inr == 150000 - 78000
    cost_step = next(w for w in r.working if w.id == "cost")
    assert cost_step.source is None and cost_step.formula == "your quote"


def test_shading_reduces_yield() -> None:
    clear = calc_solar(inputs(size_override_kw=2))
    heavy = calc_solar(inputs(size_override_kw=2, shading="heavy"))
    assert heavy.annual_generation_kwh == pytest.approx(
        clear.annual_generation_kwh * 0.75, rel=1e-3
    )


def test_every_constant_step_cites_a_source() -> None:
    r = calc_solar(inputs())
    for step_id in ("specific_yield", "size", "cost", "subsidy", "savings_year1", "co2"):
        step = next(w for w in r.working if w.id == step_id)
        assert step.source is not None, step_id
