"""Eval: overnight leak detection on synthetic streams.

Target: precision ≥ 0.90, recall ≥ 0.85, over 20 injected leaks of different sizes,
with realistic night-time noise (occasional 3 am flushes). Each night is a case: a
"positive" if a leak was running that night.

Writes services/api/app/data/eval_leak.json (shown on the Methodology page) and prints
a table. Run: services/api/.venv/Scripts/python scripts/eval_leak_detector.py
"""

import json
import random
import statistics
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.calc.water import Reading, daily_usage, stream_night_flow  # noqa: E402
from synthetic_water import Leak, household_stream  # noqa: E402

DAYS = 200
N_LEAKS = 20
# Leak sizes span a dripping tap to a running toilet (litres per hour)
SIZES = [1.0, 1.5, 2, 3, 4, 6, 8, 10, 15, 20, 30]


def run(seed: int) -> dict[str, object]:
    rng = random.Random(seed)
    leaks: list[Leak] = []
    day = 5
    for _ in range(N_LEAKS):
        length = rng.randint(2, 5)
        leaks.append(Leak(start_day=day, end_day=day + length, litres_per_hour=rng.choice(SIZES)))
        day += length + rng.randint(3, 6)
    days = max(DAYS, day + 2)
    stream = household_stream(days, datetime(2026, 1, 1), leaks, seed=seed + 100)
    readings = [Reading(at=t, kind="meter", value=v) for t, v in stream]
    daily = daily_usage(readings)
    typical = statistics.median(d.litres for d in daily)
    nights = stream_night_flow(readings, typical)

    start = date(2026, 1, 1)
    leaky_days = {
        (start.toordinal() + d)
        for leak in leaks
        for d in range(leak.start_day, leak.end_day)
    }
    tp = fp = fn = tn = 0
    misses: list[dict[str, float | str]] = []
    for n in nights:
        positive = date.fromisoformat(n.night).toordinal() in leaky_days
        if n.leak and positive:
            tp += 1
        elif n.leak:
            fp += 1
        elif positive:
            fn += 1
            size = next(
                lk.litres_per_hour
                for lk in leaks
                if lk.start_day <= date.fromisoformat(n.night).toordinal() - start.toordinal() < lk.end_day
            )
            misses.append({"night": n.night, "leak_litres_per_hour": size, "measured_litres": n.litres})
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "seed": seed,
        "typical_daily_litres": round(typical, 0),
        "nights": len(nights),
        "true_positive": tp,
        "false_positive": fp,
        "false_negative": fn,
        "true_negative": tn,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "misses": misses,
    }


def main() -> None:
    runs = [run(seed) for seed in (1, 2, 3, 4, 5)]
    precisions = [float(r["precision"]) for r in runs]  # type: ignore[arg-type]
    recalls = [float(r["recall"]) for r in runs]  # type: ignore[arg-type]
    out = {
        "run_on": date.today().isoformat(),
        "data": "Synthetic 15-minute household meter stream (scripts/synthetic_water.py) with a "
        "1-litre meter resolution; 5 runs × ~200 nights, 20 injected leaks of 1–30 litres an "
        "hour each; night-time noise: single and double toilet flushes and taps or showers "
        "left on for 30–45 minutes. Not real household data: real performance is measured "
        "in the pilot.",
        "targets": {"precision": 0.9, "recall": 0.85},
        "precision": round(statistics.mean(precisions), 3),
        "recall": round(statistics.mean(recalls), 3),
        "worst_precision": round(min(precisions), 3),
        "worst_recall": round(min(recalls), 3),
        "runs": runs,
    }
    path = ROOT / "services" / "api" / "app" / "data" / "eval_leak.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({k: v for k, v in out.items() if k != "runs"}, indent=2))
    for r in runs:
        print({k: r[k] for k in ("seed", "precision", "recall", "false_positive", "false_negative")})


if __name__ == "__main__":
    main()
