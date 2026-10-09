from datetime import datetime, timedelta

import pytest

from app.calc.water import (
    DailyUse,
    Reading,
    anomalies,
    daily_usage,
    litres_saved,
    lpcd,
    night_flow_leak,
    tank_forecast,
)


def meter(at: str, litres: float) -> Reading:
    return Reading(at=datetime.fromisoformat(at), kind="meter", value=litres)


def tank(at: str, pct: float, cap: float = 1000) -> Reading:
    return Reading(at=datetime.fromisoformat(at), kind="tank", value=pct, tank_litres=cap)


def test_meter_usage_split_across_midnight() -> None:
    days = daily_usage([meter("2026-09-01T18:00", 1000), meter("2026-09-02T06:00", 1600)])
    # 600 L over 12 h: 6 h on the 1st, 6 h on the 2nd
    assert [(d.day, d.litres) for d in days] == [("2026-09-01", 300.0), ("2026-09-02", 300.0)]


def test_tank_rises_are_refills_not_use() -> None:
    days = daily_usage(
        [tank("2026-09-01T06:00", 90), tank("2026-09-01T20:00", 40), tank("2026-09-02T06:00", 95)]
    )
    assert [(d.day, d.litres) for d in days] == [("2026-09-01", 500.0)]


def test_lpcd_against_cpheeo_benchmark() -> None:
    r = lpcd(540, 4)
    assert r.lpcd == 135 and r.benchmark == 135 and r.ratio == 1.0
    assert r.working.source is not None and "135" in r.working.source.name


def test_night_flow_leak_detected() -> None:
    # 40 L moved in 8 h with nobody using water → 120 L/day leak
    r = night_flow_leak(meter("2026-09-01T23:00", 5000), meter("2026-09-02T07:00", 5040), 600)
    assert r.leak and r.threshold_litres == 12.0 and r.litres_per_day == 120


def test_small_movement_is_noise() -> None:
    r = night_flow_leak(meter("2026-09-01T23:00", 5000), meter("2026-09-02T07:00", 5004), 150)
    assert not r.leak and r.litres_per_day == 0


def test_tank_level_drop_overnight_is_a_leak() -> None:
    r = night_flow_leak(tank("2026-09-01T23:00", 60), tank("2026-09-02T06:00", 57), None)
    assert r.leak and r.window_litres == 30.0


@pytest.mark.parametrize("hours", [1, 20])
def test_leak_check_window_limits(hours: int) -> None:
    start = datetime(2026, 9, 1, 22)
    with pytest.raises(ValueError):
        night_flow_leak(
            Reading(at=start, kind="meter", value=0),
            Reading(at=start + timedelta(hours=hours), kind="meter", value=10),
            None,
        )


def series(values: list[int]) -> list[DailyUse]:
    start = datetime(2026, 8, 1)
    return [
        DailyUse(day=(start + timedelta(days=i)).date().isoformat(), litres=v)
        for i, v in enumerate(values)
    ]


def test_anomalies_need_a_run_of_two_days() -> None:
    base = [500, 520, 480, 510, 495, 505, 490, 515, 500, 485]
    one_spike = series(base + [900, 500])
    assert anomalies(one_spike) == []  # a single tanker/guest day isn't flagged
    run = series(base + [900, 880, 500])
    flagged = anomalies(run)
    assert [a.day for a in flagged] == ["2026-08-11", "2026-08-12"]


def test_tank_forecast_and_tankers() -> None:
    r = tank_forecast(50, 2000, 400, horizon_days=10, tanker_litres=5000, inr_per_tanker=1200)
    assert r.litres_now == 1000 and r.days_to_empty == 2.5
    # need 4000 L over 10 days, have 1000 → 3000 short → 1 tanker
    assert r.tankers_needed == 1 and r.tanker_cost_inr == 1200


def test_litres_saved_only_after_a_real_drop() -> None:
    ok = litres_saved(
        baseline_before=700, mean_after=560, leak_litres_per_day=150, days_since_fix=10
    )
    assert ok.counted and ok.litres == 1400
    nope = litres_saved(
        baseline_before=700, mean_after=680, leak_litres_per_day=150, days_since_fix=10
    )
    assert not nope.counted and nope.litres == 0


def test_stream_night_flow_flags_only_leaky_nights() -> None:
    from app.calc.water import stream_night_flow

    pts = []
    total = 0.0
    start = datetime(2026, 9, 1, 0, 0)
    for minute in range(0, 3 * 24 * 60, 15):
        t = start + timedelta(minutes=minute)
        hour = t.hour
        use = 6.0 if 6 <= hour < 22 else 0.0  # daytime use
        leak = 0.4 if t.day == 2 else 0.0  # ~38 L/day leak on the night of the 2nd
        total += use + leak
        pts.append(Reading(at=t, kind="meter", value=total))
    nights = stream_night_flow(pts, typical_daily_litres=400)
    flagged = [n.night for n in nights if n.leak]
    assert flagged == ["2026-09-02"]
