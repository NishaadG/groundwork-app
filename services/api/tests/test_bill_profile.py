from datetime import date

import pytest

from app.calc.bill import HistoryPoint, monthly_profile


def test_single_bill_without_history_is_flat() -> None:
    p = monthly_profile(300, None, None)
    assert p.monthly_units == [300.0] * 12
    assert p.months_from_data == 0


def test_billing_period_normalised_to_average_month() -> None:
    # 61-day bill (bi-monthly) of 610 units → 304.17 per average month, placed in the end month
    p = monthly_profile(610, date(2026, 6, 1), date(2026, 7, 31))
    assert p.monthly_units[6] == pytest.approx(610 * 30.4167 / 61, abs=0.05)
    # Other months take the average of known months (only one known)
    assert p.monthly_units[0] == p.monthly_units[6]
    assert p.months_from_data == 1


def test_history_fills_calendar_months_and_rest_take_average() -> None:
    history = [
        HistoryPoint(month="2026-03", units=250),
        HistoryPoint(month="2026-04", units=320),
        HistoryPoint(month="2026-05", units=360),
    ]
    p = monthly_profile(300, date(2026, 5, 16), date(2026, 6, 14), history)
    # June comes from the current bill (30 days → ×1.0139)
    assert p.monthly_units[5] == pytest.approx(300 * 30.4167 / 30, abs=0.05)
    assert p.monthly_units[2] == 250 and p.monthly_units[3] == 320 and p.monthly_units[4] == 360
    avg = (250 + 320 + 360 + p.monthly_units[5]) / 4
    assert p.monthly_units[0] == pytest.approx(avg, abs=0.01)
    assert p.months_from_data == 4
    assert p.working.inputs["months_with_data"] == 4


def test_latest_reading_for_a_month_wins() -> None:
    history = [HistoryPoint(month="2025-07", units=100), HistoryPoint(month="2026-07", units=200)]
    p = monthly_profile(150, None, None, history)
    assert p.monthly_units[6] == 200


def test_bad_month_rejected() -> None:
    with pytest.raises(ValueError):
        HistoryPoint(month="2026-13", units=1)
