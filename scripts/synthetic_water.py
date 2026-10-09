"""Synthetic household water-meter stream.

A clearly labelled stand-in for a real smart meter: 15-minute cumulative readings
with a morning and evening peak, random daytime use, occasional night use (a 3 am
toilet flush, a late shower) and, optionally, leaks of chosen size on chosen nights.

Used by scripts/replay_meter_stream.py (live demo) and scripts/eval_leak_detector.py.
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

STEP_MIN = 15


@dataclass
class Leak:
    start_day: int  # day index the leak starts (inclusive)
    end_day: int  # day index it stops (exclusive, i.e. fixed)
    litres_per_hour: float


def household_stream(
    days: int,
    start: datetime,
    leaks: list[Leak] | None = None,
    seed: int = 7,
    night_use_chance: float = 0.12,
    resolution_litres: float = 1.0,
) -> list[tuple[datetime, float]]:
    """Cumulative litres every 15 minutes, as a pulse meter with `resolution_litres`
    resolution reports it. Times are naive local time (IST)."""
    rng = random.Random(seed)
    leaks = leaks or []
    total = 50_000.0
    out: list[tuple[datetime, float]] = []
    # Night-time noise the detector must tolerate (02:00–05:00): one flush, two flushes,
    # or a tap/shower left running for 30–45 minutes
    def pick() -> str | None:
        r = rng.random()
        if r < night_use_chance:
            return "flush"
        if r < night_use_chance * 1.5:
            return "two_flushes"
        if r < night_use_chance * 1.8:
            return "long_use"
        return None

    night_use = {d: pick() for d in range(days)}
    long_len = {d: rng.choice([2, 3]) for d in range(days)}
    for step in range(days * 24 * 60 // STEP_MIN):
        t = start + timedelta(minutes=step * STEP_MIN)
        day = step * STEP_MIN // (24 * 60)
        h = t.hour + t.minute / 60
        if 6 <= h < 9:
            use = rng.uniform(15, 35)  # morning peak: baths, cooking
        elif 18 <= h < 22:
            use = rng.uniform(8, 22)  # evening peak
        elif 9 <= h < 18:
            use = rng.uniform(0, 8)
        elif h >= 22 or h < 1:
            use = rng.uniform(0, 3)
        else:
            use = 0.0
        kind = night_use[day]
        if kind in ("flush", "two_flushes") and t.hour == 3 and t.minute == 15:
            use += rng.uniform(5, 9)
        if kind == "two_flushes" and t.hour == 4 and t.minute == 30:
            use += rng.uniform(5, 9)
        if kind == "long_use" and 2.5 <= h < 2.5 + 0.25 * long_len[day]:
            use += rng.uniform(4, 7)
        for leak in leaks:
            if leak.start_day <= day < leak.end_day:
                use += leak.litres_per_hour * STEP_MIN / 60
        total += use
        reported = (total // resolution_litres) * resolution_litres if resolution_litres else total
        out.append((t, round(reported, 2)))
    return out
