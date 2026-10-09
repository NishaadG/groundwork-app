"""Simulated smart-meter feed. Always label it in the UI and video as
"Simulated smart-meter feed (synthetic household data)".

Backfills N days of a synthetic household stream through the real IoT endpoint, with an
optional leak on the most recent nights so the overnight alert fires, then (with --live)
keeps sending a reading every --interval seconds.

    1. In the app, Water → Smart meter → Add a device. Copy the key (shown once).
    2. python scripts/replay_meter_stream.py --api https://<function-url> --key gwd_... \\
           --days 21 --leak-nights 3 --leak-lph 6 --live

Uses only the standard library, so any Python 3.10+ works.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synthetic_water import STEP_MIN, Leak, household_stream  # noqa: E402

IST = timedelta(hours=5, minutes=30)
BATCH = 200


def post(api: str, key: str, readings: list[dict[str, object]]) -> None:
    req = urllib.request.Request(
        f"{api.rstrip('/')}/v1/iot/ingest",
        data=json.dumps({"readings": readings}).encode(),
        headers={"Content-Type": "application/json", "X-Device-Key": key},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                body = json.load(resp)
            break
        except urllib.error.HTTPError as err:
            sys.exit(f"ingest failed: HTTP {err.code} {err.read().decode(errors='replace')}")
        except (TimeoutError, urllib.error.URLError) as err:
            if attempt == 2:
                sys.exit(f"ingest failed: {err}")
            time.sleep(2 * (attempt + 1))
    print(f"sent {body['data']['accepted']} readings (last {readings[-1]['at']})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", required=True, help="API base URL (the Function URL)")
    ap.add_argument("--key", required=True, help="device key from the app (gwd_...)")
    ap.add_argument("--days", type=int, default=21, help="days of history to backfill")
    ap.add_argument("--leak-nights", type=int, default=0, help="add a leak on the last N nights")
    ap.add_argument("--leak-lph", type=float, default=6.0, help="leak size, litres per hour")
    ap.add_argument("--live", action="store_true", help="keep sending after the backfill")
    ap.add_argument("--interval", type=float, default=10.0, help="seconds between live readings")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    now_ist = datetime.now(UTC).replace(tzinfo=None) + IST
    start_ist = (now_ist - timedelta(days=args.days)).replace(hour=0, minute=0, second=0, microsecond=0)
    leaks = []
    if args.leak_nights:
        leaks.append(Leak(start_day=args.days - args.leak_nights, end_day=args.days + 1, litres_per_hour=args.leak_lph))
    stream = household_stream(args.days + 1, start_ist, leaks, seed=args.seed)
    past = [(t, v) for t, v in stream if t <= now_ist]

    def to_utc(t: datetime) -> str:
        return (t - IST).replace(tzinfo=UTC).isoformat()

    for i in range(0, len(past), BATCH):
        post(args.api, args.key, [{"at": to_utc(t), "value": v} for t, v in past[i : i + BATCH]])

    if not args.live:
        return
    # Live: continue the same synthetic pattern in real time, one reading per interval.
    future = [(t, v) for t, v in stream if t > now_ist]
    total = past[-1][1] if past else 50_000.0
    prev = past[-1][1] if past else total
    print(f"live: one reading every {args.interval:g}s (Ctrl+C to stop)")
    for _, v in future:
        total += (v - prev) * args.interval / (STEP_MIN * 60)  # scale a 15-min step to the interval
        prev = v
        post(args.api, args.key, [{"at": datetime.now(UTC).isoformat(), "value": round(total, 2)}])
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
