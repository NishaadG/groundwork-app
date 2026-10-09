import pytest

from app.calc.tariff import (
    BillContext,
    available_tariffs,
    bill_breakdown,
    bill_total,
    check_bill,
    load_tariff,
    marginal_rate,
)

MSEDCL = load_tariff("msedcl")


def msedcl_by_hand(units: float, fixed: float = 130, fac: float = 0) -> float:
    """MERC Case 75 of 2025, FY 2026-27, LT-I(B), telescopic slabs + 16% duty."""
    slabs = [(100, 3.96), (300, 10.80), (500, 15.03), (float("inf"), 17.53)]
    energy, lower = 0.0, 0.0
    for upper, rate in slabs:
        energy += max(0.0, min(units, upper) - lower) * rate
        lower = upper
    subtotal = fixed + energy + units * 1.60 + units * fac
    return subtotal * 1.16


def test_all_tariff_files_load() -> None:
    ids = available_tariffs()
    assert "msedcl" in ids
    for tariff_id in ids:
        t = load_tariff(tariff_id)
        assert t.slabs[-1].upto_units is None, f"{tariff_id}: last slab must be open"
        assert t.source_url.startswith("https://")


@pytest.mark.parametrize("units", [0, 1, 50, 100, 101, 250, 300, 301, 450, 500, 501, 800])
def test_msedcl_matches_hand_calculation(units: float) -> None:
    assert bill_total(units, MSEDCL) == pytest.approx(msedcl_by_hand(units), abs=0.01)


def test_msedcl_250_units_breakdown() -> None:
    b = bill_breakdown(250, MSEDCL)
    assert b.energy == pytest.approx(100 * 3.96 + 150 * 10.80)  # 2016
    assert b.charges["wheeling"] == pytest.approx(400)
    assert b.fixed == 130
    assert b.charges["electricity_duty"] == pytest.approx(2546 * 0.16)
    assert b.total == pytest.approx(2953.36)
    assert [s.units for s in b.slabs] == [100, 150]


def test_three_phase_and_fac() -> None:
    ctx = BillContext(supply="three", inputs={"fac": 0.5})
    assert bill_total(200, MSEDCL, ctx) == pytest.approx(msedcl_by_hand(200, fixed=435, fac=0.5))


def test_marginal_rate_uses_top_slab() -> None:
    # 350 units sits in the 301–500 slab: (15.03 + 1.60) × 1.16
    assert marginal_rate(350, MSEDCL) == pytest.approx((15.03 + 1.60) * 1.16)
    assert marginal_rate(80, MSEDCL) == pytest.approx((3.96 + 1.60) * 1.16)
    assert marginal_rate(0, MSEDCL) == 0


def test_check_bill_flags_mismatch() -> None:
    exact = check_bill(250, 2953.36, MSEDCL)
    assert exact.matches and exact.diff_pct == 0
    off = check_bill(250, 3400, MSEDCL)
    assert not off.matches and off.diff_pct == pytest.approx(15.1, abs=0.1)
    assert off.working[0].source is not None


def test_negative_units_rejected() -> None:
    with pytest.raises(ValueError):
        bill_total(-1, MSEDCL)


def test_unknown_tariff() -> None:
    with pytest.raises(KeyError):
        load_tariff("nope")


def test_tata_power_mumbai_by_hand() -> None:
    t = load_tariff("tata-power-mumbai")
    # 350 units: 100×1.90 + 200×4.70 + 50×9.24 = 1592; wheeling 350×2.40 = 840;
    # fixed ₹135 (101–500 units); FAC 0.40 → 140; duty 16% of all four.
    ctx = BillContext(inputs={"fac": 0.40, "tax_on_sale": 0.20})
    subtotal = 1592 + 840 + 135 + 140
    expected = subtotal * 1.16 + 350 * 0.20
    assert bill_total(350, t, ctx) == pytest.approx(expected)
    # Fixed charge follows the units: ₹90 at 100 units or less, ₹160 above 500.
    assert bill_breakdown(80, t).fixed == 90
    assert bill_breakdown(600, t).fixed == 160
    assert bill_breakdown(80, t, BillContext(supply="three")).fixed == 160
    # ₹250 per 10 kW (or part) above 10 kW
    assert bill_breakdown(80, t, BillContext(load_kw=21)).fixed == 90 + 2 * 250


def test_adani_mumbai_by_hand() -> None:
    t = load_tariff("adani-mumbai")
    # 250 units: 100×2.65 + 150×5.85 = 1142.5; wheeling 570; fixed 135
    assert bill_total(250, t) == pytest.approx((1142.5 + 570 + 135) * 1.16)


def test_bescom_by_hand() -> None:
    t = load_tariff("bescom")
    # 3 kW load, 250 units: fixed 450, energy 1450, P&G 87.5, tax 9% of fixed+energy
    ctx = BillContext(load_kw=3)
    expected = 450 + 1450 + 250 * 0.35 + (450 + 1450) * 0.09
    assert bill_total(250, t, ctx) == pytest.approx(expected)
    assert marginal_rate(250, t, ctx) == pytest.approx(5.80 * 1.09 + 0.35)
    assert t.net_metering.surplus == "monthly_settlement"


def test_bses_rajdhani_by_hand() -> None:
    t = load_tariff("bses-rajdhani")
    # 4 kW load → ₹50/kW band = 200; 450 units: 200×3 + 200×4.5 + 50×6.5 = 1825
    ctx = BillContext(load_kw=4, inputs={"ppac": 20})
    base = 200 + 1825
    expected = base + base * 0.20 + base * 0.08 + base * 0.07
    assert bill_total(450, t, ctx) == pytest.approx(expected)
    assert bill_breakdown(10, t, BillContext(load_kw=1.5)).fixed == pytest.approx(30)


def test_bill_inputs_default_to_zero() -> None:
    for tariff_id in available_tariffs():
        t = load_tariff(tariff_id)
        for bi in t.bill_inputs:
            assert bi.default == 0, f"{tariff_id}.{bi.id} has an unsourced default"
            assert bi.note
