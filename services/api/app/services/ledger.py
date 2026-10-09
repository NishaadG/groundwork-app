"""The impact ledger.

Every entry has a basis, so the dashboard never mixes potential with reality:
- `projected`: what a plan would do (a solar report). Only the latest per kind counts.
- `estimated`: something done, with a modelled value (an installed system's output,
  pro-rated from the install date until the user logs real bills).
- `measured`: from the user's own readings (water, waste weights, bills).

Totals are summed from entries on read, so they always equal the sum of entries.
"""

import uuid
from collections import defaultdict
from datetime import date
from typing import Any, Literal

from boto3.dynamodb.conditions import Key

from app import db

Basis = Literal["projected", "estimated", "measured"]
Metric = Literal["inr", "kwh", "litres", "kg", "co2_t"]
Resource = Literal["energy", "water", "waste"]
BASES: tuple[Basis, ...] = ("projected", "estimated", "measured")


def entries(sub: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(db.user_pk(sub)) & Key("SK").begins_with("LEDGER#")
    }
    while True:
        res = db.table().query(**kwargs)
        items.extend(db.from_dynamo(i) for i in res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            return items
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _entry(
    sub: str,
    *,
    kind: str,
    resource: Resource,
    metric: Metric,
    value: float,
    basis: Basis,
    source_ref: str,
    month: str,
    period: str,
) -> dict[str, Any]:
    item: dict[str, Any] = db.to_dynamo(
        {
            "PK": db.user_pk(sub),
            "SK": f"LEDGER#{month}#{uuid.uuid4().hex[:12]}",
            "kind": kind,
            "resource": resource,
            "metric": metric,
            "value": float(value),
            "basis": basis,
            "period": period,
            "month": month,
            "source_ref": source_ref,
            "created_at": db.now_iso(),
        }
    )
    return item


def delete_where(sub: str, **match: Any) -> int:
    pk = db.user_pk(sub)
    old = [e for e in entries(sub) if all(e.get(k) == v for k, v in match.items())]
    with db.table().batch_writer() as batch:
        for e in old:
            batch.delete_item(Key={"PK": pk, "SK": e["SK"]})
    return len(old)


def replace_projection(
    sub: str,
    kind: str,
    source_ref: str,
    resource: Resource,
    values: dict[Metric, float],
) -> None:
    """Replace all projected entries of `kind` (e.g. "solar") with these yearly values."""
    delete_where(sub, kind=kind, basis="projected")
    month = db.now_iso()[:7]
    with db.table().batch_writer() as batch:
        for metric, value in values.items():
            batch.put_item(
                Item=_entry(
                    sub,
                    kind=kind,
                    resource=resource,
                    metric=metric,
                    value=value,
                    basis="projected",
                    source_ref=source_ref,
                    month=month,
                    period="year",
                )
            )


def months_between(start: date, end: date) -> list[tuple[str, float]]:
    """Calendar months from start to end (inclusive), with the fraction of each month covered."""
    out: list[tuple[str, float]] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        first = date(y, m, 1)
        nxt = date(y + (m == 12), m % 12 + 1, 1)
        days = (nxt - first).days
        lo = max(start, first)
        hi = min(end, date.fromordinal(nxt.toordinal() - 1))
        covered = (hi - lo).days + 1
        if covered > 0:
            out.append((f"{y:04d}-{m:02d}", covered / days))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def record_installed_solar(
    sub: str,
    source_ref: str,
    installed_on: date,
    monthly_kwh: list[float],
    monthly_inr: list[float],
    co2_per_kwh_t: float,
    today: date | None = None,
) -> int:
    """Month-by-month estimated output of an installed system, from install date to today."""
    today = today or date.today()
    delete_where(sub, kind="solar", basis="estimated")
    count = 0
    with db.table().batch_writer() as batch:
        for month, frac in months_between(installed_on, today):
            i = int(month[5:7]) - 1
            kwh = monthly_kwh[i] * frac
            for metric, value in (
                ("kwh", kwh),
                ("inr", monthly_inr[i] * frac),
                ("co2_t", kwh * co2_per_kwh_t),
            ):
                batch.put_item(
                    Item=_entry(
                        sub,
                        kind="solar",
                        resource="energy",
                        metric=metric,  # type: ignore[arg-type]
                        value=round(value, 4),
                        basis="estimated",
                        source_ref=source_ref,
                        month=month,
                        period="month",
                    )
                )
                count += 1
    return count


def totals(sub: str) -> dict[str, Any]:
    """Sums per basis and metric, plus per-month series for estimated and measured."""
    out: dict[str, dict[str, float]] = {b: defaultdict(float) for b in BASES}
    series: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    items = entries(sub)
    for e in items:
        basis = e["basis"]
        out[basis][e["metric"]] += float(e["value"])
        if basis != "projected":
            month = e.get("month") or e["SK"].split("#")[1]
            cell = series[e["metric"]][month]
            cell[basis] = round(cell.get(basis, 0.0) + float(e["value"]), 4)
    this_month = db.now_iso()[:7]
    month_totals: dict[str, float] = defaultdict(float)
    for e in items:
        if e["basis"] != "projected" and (e.get("month") or "") == this_month:
            month_totals[e["metric"]] += float(e["value"])
    return {
        **{b: {k: round(v, 3) for k, v in out[b].items()} for b in BASES},
        "this_month": {k: round(v, 3) for k, v in month_totals.items()},
        "series": {m: dict(sorted(v.items())) for m, v in series.items()},
        "entries": len(items),
    }
