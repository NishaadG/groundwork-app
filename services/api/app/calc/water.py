"""Water maths. Pure, deterministic, traced.

Readings are either a cumulative water meter (litres) or an overhead tank level (%
of capacity). Every function returns its numbers plus a `working` step.
"""

import math
import statistics
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field

from app.calc.working import Source, WorkingStep
from app.data.constants import get

Kind = Literal["meter", "tank"]

# Groundwork assumptions (shown as such in the UI)
LEAK_MIN_LITRES = 5.0  # below this, an overnight change is reading noise
LEAK_DAILY_SHARE = 0.02  # or 2% of a normal day's use, whichever is larger
ANOMALY_WINDOW_DAYS = 14
ANOMALY_K = 3.0  # rolling median ± 3 × MAD
ANOMALY_RUN = 2  # flag only runs of 2 or more high days
SAVED_MIN_SHARE = 0.5  # a fix counts only if use drops by at least half the leak


class Reading(BaseModel):
    at: datetime
    kind: Kind
    value: float = Field(ge=0)  # meter: litres on the dial; tank: % full
    tank_litres: float | None = None  # tank capacity, for tank readings


def _litres(r: Reading) -> float:
    if r.kind == "meter":
        return r.value
    if not r.tank_litres:
        raise ValueError("tank readings need the tank capacity")
    return r.value / 100 * r.tank_litres


class DailyUse(BaseModel):
    day: str  # YYYY-MM-DD
    litres: float


def daily_usage(readings: list[Reading]) -> list[DailyUse]:
    """Litres used per calendar day, from consecutive readings of one kind.

    Meter: the dial's increase, spread evenly over the hours between readings.
    Tank: only drops count as use (a rise is a refill); spread the same way.
    """
    rs = sorted(readings, key=lambda r: r.at)
    per_day: dict[str, float] = {}
    for a, b in zip(rs, rs[1:], strict=False):
        if a.kind != b.kind:
            continue
        hours = (b.at - a.at).total_seconds() / 3600
        if hours <= 0:
            continue
        delta = _litres(b) - _litres(a)
        used = delta if a.kind == "meter" else -delta
        if used <= 0:
            continue
        # spread across the calendar days the interval covers
        t = a.at
        while t < b.at:
            next_midnight = datetime.combine(
                t.date() + timedelta(days=1), datetime.min.time(), t.tzinfo
            )
            end = min(next_midnight, b.at)
            share = (end - t).total_seconds() / 3600 / hours
            key = t.date().isoformat()
            per_day[key] = per_day.get(key, 0.0) + used * share
            t = end
    return [DailyUse(day=d, litres=round(v, 1)) for d, v in sorted(per_day.items())]


class Lpcd(BaseModel):
    lpcd: float
    benchmark: float
    ratio: float
    working: WorkingStep


def lpcd(daily_litres: float, household: int) -> Lpcd:
    bench = float(get("urban_water_benchmark_lpcd").value)
    value = daily_litres / max(household, 1)
    return Lpcd(
        lpcd=round(value, 1),
        benchmark=bench,
        ratio=round(value / bench, 2),
        working=WorkingStep(
            id="lpcd",
            label="Water per person per day",
            formula="average litres a day ÷ people in your home, compared with the urban benchmark",
            inputs={
                "litres_per_day": round(daily_litres, 1),
                "people": household,
                "benchmark_lpcd": bench,
            },
            result=round(value, 1),
            unit="litres per person per day",
            source=get("urban_water_benchmark_lpcd").as_source(),
        ),
    )


class LeakCheck(BaseModel):
    leak: bool
    window_hours: float
    window_litres: float
    threshold_litres: float
    litres_per_day: float
    working: WorkingStep


def night_flow_leak(
    night: Reading, morning: Reading, typical_daily_litres: float | None
) -> LeakCheck:
    """Two readings with no water used in between. Anything that moved is a leak."""
    if night.kind != morning.kind:
        raise ValueError("both readings must be of the same kind")
    hours = (morning.at - night.at).total_seconds() / 3600
    if not 3 <= hours <= 16:
        raise ValueError("the check needs 3 to 16 hours between readings")
    moved = _litres(morning) - _litres(night)
    window = moved if night.kind == "meter" else -moved
    window = max(window, 0.0)
    threshold = max(LEAK_MIN_LITRES, LEAK_DAILY_SHARE * (typical_daily_litres or 0.0))
    leak = window > threshold
    per_day = window * 24 / hours if leak else 0.0
    return LeakCheck(
        leak=leak,
        window_hours=round(hours, 2),
        window_litres=round(window, 1),
        threshold_litres=round(threshold, 1),
        litres_per_day=round(per_day, 0),
        working=WorkingStep(
            id="leak_check",
            label="Overnight leak check",
            formula=(
                "water that moved while nobody used any; a leak if it is more than 5 litres or "
                "2% of a normal day, whichever is larger; "
                "litres a day = litres in the window × 24 ÷ hours"
            ),
            inputs={
                "hours": round(hours, 2),
                "litres_in_window": round(window, 1),
                "threshold_litres": round(threshold, 1),
            },
            result=round(per_day, 0),
            unit="litres a day",
            source=Source(
                name="Night-flow method; thresholds are Groundwork assumptions", status="assumption"
            ),
        ),
    )


class Anomaly(BaseModel):
    day: str
    litres: float
    upper: float


def anomalies(series: list[DailyUse]) -> list[Anomaly]:
    """Days above the rolling 14-day median + 3 × MAD, reported only in runs of 2+ days.
    Median and MAD are robust to the odd tanker refill or guest day."""
    flagged: list[Anomaly] = []
    for i, d in enumerate(series):
        window = [x.litres for x in series[max(0, i - ANOMALY_WINDOW_DAYS) : i]]
        if len(window) < 7:
            continue
        med = statistics.median(window)
        mad = statistics.median(abs(x - med) for x in window) or max(med * 0.05, 1.0)
        upper = med + ANOMALY_K * 1.4826 * mad
        if d.litres > upper:
            flagged.append(Anomaly(day=d.day, litres=d.litres, upper=round(upper, 1)))
    # keep only runs of consecutive days
    days = {a.day for a in flagged}

    def in_run(a: Anomaly) -> bool:
        day = datetime.fromisoformat(a.day).date()
        neighbours = {(day + timedelta(days=k)).isoformat() for k in (-1, 1)}
        return bool(neighbours & days)

    return [a for a in flagged if ANOMALY_RUN <= 1 or in_run(a)]


class TankForecast(BaseModel):
    days_to_empty: float | None
    litres_now: float
    litres_per_day: float
    tankers_needed: int | None
    tanker_cost_inr: float | None
    working: WorkingStep


def tank_forecast(
    level_pct: float,
    tank_litres: float,
    litres_per_day: float,
    horizon_days: int = 30,
    tanker_litres: float | None = None,
    inr_per_tanker: float | None = None,
) -> TankForecast:
    now = level_pct / 100 * tank_litres
    days = now / litres_per_day if litres_per_day > 0 else None
    tankers = cost = None
    if tanker_litres and litres_per_day > 0:
        shortfall = max(litres_per_day * horizon_days - now, 0.0)
        tankers = math.ceil(shortfall / tanker_litres)
        cost = tankers * inr_per_tanker if inr_per_tanker is not None else None
    return TankForecast(
        days_to_empty=None if days is None else round(days, 1),
        litres_now=round(now, 0),
        litres_per_day=round(litres_per_day, 0),
        tankers_needed=tankers,
        tanker_cost_inr=cost,
        working=WorkingStep(
            id="tank_forecast",
            label="Days until the tank runs dry",
            formula="water in the tank ÷ your average use a day; tankers = shortfall over the next "
            f"{horizon_days} days ÷ tanker size, rounded up",
            inputs={
                "level_pct": level_pct,
                "tank_litres": tank_litres,
                "litres_per_day": round(litres_per_day, 0),
                "tanker_litres": tanker_litres,
                "inr_per_tanker": inr_per_tanker,
            },
            result=None if days is None else round(days, 1),
            unit="days",
        ),
    )


class Saved(BaseModel):
    counted: bool
    litres: float
    drop_per_day: float
    working: WorkingStep


def litres_saved(
    baseline_before: float, mean_after: float, leak_litres_per_day: float, days_since_fix: float
) -> Saved:
    """Counted only if use actually fell by at least half the estimated leak."""
    drop = baseline_before - mean_after
    counted = leak_litres_per_day > 0 and drop >= SAVED_MIN_SHARE * leak_litres_per_day
    litres = max(drop, 0.0) * days_since_fix if counted else 0.0
    return Saved(
        counted=counted,
        litres=round(litres, 0),
        drop_per_day=round(drop, 1),
        working=WorkingStep(
            id="litres_saved",
            label="Water saved since the fix",
            formula="(your daily use before − your daily use since) × days since the fix; counted "
            "only if use fell by at least half the leak we measured",
            inputs={
                "before_litres_per_day": round(baseline_before, 1),
                "after_litres_per_day": round(mean_after, 1),
                "leak_litres_per_day": round(leak_litres_per_day, 0),
                "days_since_fix": round(days_since_fix, 1),
            },
            result=round(litres, 0),
            unit="litres",
            source=Source(
                name="Groundwork rule: savings need a measured drop", status="assumption"
            ),
        ),
    )


# ---- Streams (smart meter / IoT): automatic night-flow check ----

NIGHT_START_H = 2
NIGHT_END_H = 5  # 02:00–05:00 local, when almost nobody uses water
IST = timedelta(hours=5, minutes=30)
STREAM_FLOWING_SHARE = 0.25  # water moved in at least a quarter of the night's intervals
STREAM_MIN_LITRES = 2.0  # and at least 2 litres outside the biggest single interval


class NightFlow(BaseModel):
    night: str  # date the window ends on (YYYY-MM-DD)
    litres: float
    leak: bool
    litres_per_day: float


def stream_night_flow(
    readings: list[Reading], typical_daily_litres: float | None
) -> list[NightFlow]:
    """For each night with meter readings through 02:00–05:00 (IST), decide if a leak ran.

    A leak flows steadily; a toilet flush or a late shower is one spike. So a night is a
    leak when water moved in at least a quarter of the intervals AND at least 2 litres
    moved outside the single biggest interval. The leak rate leaves out that spike.
    """
    meter = sorted((r for r in readings if r.kind == "meter"), key=lambda r: r.at)
    if len(meter) < 2:
        return []

    def local(r: Reading) -> datetime:
        return (r.at.replace(tzinfo=None) + IST) if r.at.tzinfo else r.at

    by_day: dict[str, list[tuple[datetime, float]]] = {}
    for r in meter:
        t = local(r)
        by_day.setdefault(t.date().isoformat(), []).append((t, r.value))
    out: list[NightFlow] = []
    for day, pts in sorted(by_day.items()):
        window = [(t, v) for t, v in pts if NIGHT_START_H <= t.hour + t.minute / 60 <= NIGHT_END_H]
        if len(window) < 5:
            continue
        hours = (window[-1][0] - window[0][0]).total_seconds() / 3600
        if hours < 2:
            continue
        steps = [max(b[1] - a[1], 0.0) for a, b in zip(window, window[1:], strict=False)]
        flowing = sum(1 for x in steps if x > 0) / len(steps)
        without_spike = sum(steps) - max(steps)
        leak = flowing >= STREAM_FLOWING_SHARE and without_spike >= STREAM_MIN_LITRES
        rate = without_spike / (hours * (len(steps) - 1) / len(steps)) * 24 if leak else 0.0
        out.append(
            NightFlow(
                night=day,
                litres=round(sum(steps), 1),
                leak=leak,
                litres_per_day=round(rate, 0),
            )
        )
    return out
