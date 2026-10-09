"""Home dashboard data: ledger, report card, next best action, bill trend, activity.

The next best action is chosen by rules in code (deterministic, explainable);
the UI words it from a fixed set of messages with numbers computed here.
"""

from datetime import date
from typing import Any

from boto3.dynamodb.conditions import Key

from app import db
from app.calc.report_card import BillPoint, electricity_card
from app.calc.working import Source, WorkingStep
from app.data.constants import get as constant
from app.errors import ApiError
from app.services import ledger
from app.services.solar_reports import get_report

INSTALLED_SK = "SOLAR_INSTALLED"


def _query(sub: str, prefix: str, newest_first: bool = True) -> list[dict[str, Any]]:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(db.user_pk(sub)) & Key("SK").begins_with(prefix),
        ScanIndexForward=not newest_first,
    )
    return [db.from_dynamo(i) for i in res.get("Items", [])]


def bills(sub: str) -> list[dict[str, Any]]:
    out = []
    for b in _query(sub, "BILL#", newest_first=False):
        out.append(
            {
                "id": b["id"],
                "month": b["SK"].split("#")[1],
                "units_kwh": b["units_kwh"],
                "total_amount_inr": b.get("total_amount_inr"),
                "period_start": b.get("period_start"),
                "period_end": b.get("period_end"),
                "discom": b["discom"],
                "created_at": b["created_at"],
            }
        )
    return out


def installed(sub: str) -> dict[str, Any] | None:
    item = db.table().get_item(Key={"PK": db.user_pk(sub), "SK": INSTALLED_SK}).get("Item")
    return db.from_dynamo(item) if item else None


def mark_installed(
    sub: str, report_id: str, installed_on: date, today: date | None = None
) -> dict[str, Any]:
    today = today or date.today()
    if installed_on > today:
        raise ApiError(422, "future_date", "The install date can't be in the future.")
    rep = get_report(sub, report_id)
    r = rep["report"]
    if not r["feasible"]:
        raise ApiError(422, "not_feasible", "This report has no system to install.")
    monthly_inr = [b - a for b, a in zip(r["bill_before_inr"], r["bill_after_inr"], strict=True)]
    co2_per_kwh_t = float(constant("grid_emission_factor").value) / 1000
    n = ledger.record_installed_solar(
        sub,
        f"SOLAR#{report_id}",
        installed_on,
        r["generation_kwh"],
        monthly_inr,
        co2_per_kwh_t,
        today,
    )
    # Potential has become reality: drop the solar projection
    ledger.delete_where(sub, kind="solar", basis="projected")
    item = {
        "PK": db.user_pk(sub),
        "SK": INSTALLED_SK,
        "report_id": report_id,
        "installed_on": installed_on.isoformat(),
        "updated_through": today.isoformat(),
        "monthly_kwh": r["generation_kwh"],
        "monthly_inr": monthly_inr,
        "size_kw": r["size_kw"],
    }
    db.table().put_item(Item=db.to_dynamo(item))
    return {"report_id": report_id, "installed_on": installed_on.isoformat(), "entries": n}


def unmark_installed(sub: str) -> None:
    inst = installed(sub)
    if not inst:
        return
    ledger.delete_where(sub, kind="solar", basis="estimated")
    db.table().delete_item(Key={"PK": db.user_pk(sub), "SK": INSTALLED_SK})
    rep = get_report(sub, inst["report_id"])
    r = rep["report"]
    ledger.replace_projection(
        sub,
        "solar",
        f"SOLAR#{inst['report_id']}",
        "energy",
        {
            "inr": r["savings_year1_inr"],
            "kwh": r["annual_generation_kwh"],
            "co2_t": r["co2_avoided_t_per_year"],
        },
    )


def refresh_installed(sub: str, today: date | None = None) -> None:
    """Extend the installed system's estimated months up to today (runs on read)."""
    today = today or date.today()
    inst = installed(sub)
    if not inst or inst["updated_through"] == today.isoformat():
        return
    co2_per_kwh_t = float(constant("grid_emission_factor").value) / 1000
    ledger.record_installed_solar(
        sub,
        f"SOLAR#{inst['report_id']}",
        date.fromisoformat(inst["installed_on"]),
        inst["monthly_kwh"],
        inst["monthly_inr"],
        co2_per_kwh_t,
        today,
    )
    db.table().update_item(
        Key={"PK": db.user_pk(sub), "SK": INSTALLED_SK},
        UpdateExpression="SET updated_through = :d",
        ExpressionAttributeValues={":d": today.isoformat()},
    )


def next_action(
    sub: str, bill_list: list[dict[str, Any]], card: dict[str, Any] | None
) -> dict[str, Any]:
    reports = _query(sub, "SOLAR#")
    inst = installed(sub)
    if not bill_list:
        return {"kind": "upload_bill", "href": "/app/solar/new"}
    if card and card["change_pct"] >= 15:
        return {"kind": "bill_up", "pct": round(card["change_pct"]), "href": "/app/solar"}
    if inst:
        return {"kind": "log_bill", "href": "/app/solar/new"}
    feasible = [r for r in reports if r["report"]["feasible"]]
    if feasible:
        latest = feasible[0]
        return {
            "kind": "get_quotes",
            "kw": latest["report"]["size_kw"],
            "href": f"/app/solar/{latest['id']}",
        }
    return {"kind": "log_bill", "href": "/app/solar/new"}


def activity(sub: str, bill_list: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = [
        {"type": "bill", "at": b["created_at"], "units_kwh": b["units_kwh"], "id": b["id"]}
        for b in bill_list
    ]
    for r in _query(sub, "SOLAR#"):
        items.append(
            {
                "type": "solar_report",
                "at": r["created_at"],
                "id": r["id"],
                "size_kw": r["report"]["size_kw"],
                "feasible": r["report"]["feasible"],
            }
        )
    inst = installed(sub)
    if inst:
        items.append(
            {"type": "solar_installed", "at": inst["installed_on"], "id": inst["report_id"]}
        )
    return sorted(items, key=lambda i: i["at"], reverse=True)[:limit]


METRIC_LABELS = {
    "inr": ("Money saved", "₹"),
    "kwh": ("Solar electricity", "kWh"),
    "litres": ("Water saved", "L"),
    "kg": ("Waste kept out of landfill", "kg"),
    "co2_t": ("CO₂ avoided", "t"),
}

# What each kind of realised ledger entry is, in the words the drawer shows.
KIND_NOTES = {
    "solar": (
        "your solar report's month-by-month figure for each month since the install date, "
        "pro-rated for part months"
    ),
    "water_leak_fix": (
        "litres saved after a leak fix, counted only from the measured drop in your readings"
    ),
    "waste_scan": (
        "waste you logged: recyclable or compostable kg, and CO₂ from US EPA WARM factors"
    ),
}


def ledger_working(
    sub: str, totals: dict[str, Any], inst: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """How the ledger's realised totals were made (shown in the ledger's drawer):
    each metric broken down by where its entries came from."""
    by: dict[str, dict[str, float]] = {}
    for e in ledger.entries(sub):
        if e["basis"] == "projected":
            continue
        cell = by.setdefault(e["metric"], {})
        key = f"{e['kind']}_{e['basis']}"
        cell[key] = round(cell.get(key, 0.0) + float(e["value"]), 4)
    steps: list[dict[str, Any]] = []
    for metric, (label, unit) in METRIC_LABELS.items():
        est = totals["estimated"].get(metric, 0.0)
        meas = totals["measured"].get(metric, 0.0)
        if not est and not meas:
            continue
        parts = by.get(metric, {})
        kinds = sorted({k.rsplit("_", 1)[0] for k in parts})
        inputs: dict[str, Any] = {**parts, "estimated_total": est, "measured_total": meas}
        if inst and "solar" in kinds:
            inputs |= {"system_kw": inst["size_kw"], "installed_on": inst["installed_on"]}
        formula = "realised = estimated entries + measured entries. " + "; ".join(
            f"{k}: {KIND_NOTES.get(k, k)}" for k in kinds
        )
        steps.append(
            WorkingStep(
                id=f"ledger_{metric}",
                label=label,
                formula=formula,
                inputs=inputs,
                result=round(est + meas, 3),
                unit=unit,
                source=Source(name=f"Your solar report (SOLAR#{inst['report_id']}) and your ledger")
                if inst and "solar" in kinds
                else Source(name="Your ledger entries, summed when you open this page"),
            ).model_dump()
        )
    return steps


def summary(sub: str, today: date | None = None) -> dict[str, Any]:
    refresh_installed(sub, today)
    bill_list = bills(sub)
    card = electricity_card(
        [
            BillPoint(
                units=b["units_kwh"],
                period_start=date.fromisoformat(b["period_start"])
                if b.get("period_start")
                else None,
                period_end=date.fromisoformat(b["period_end"]) if b.get("period_end") else None,
            )
            for b in bill_list
        ]
    )
    card_dict = card.model_dump() if card else None
    inst = installed(sub)
    totals = ledger.totals(sub)
    return {
        "ledger": totals,
        "ledger_working": ledger_working(sub, totals, inst),
        "report_card": {"energy": card_dict},
        "next_action": next_action(sub, bill_list, card_dict),
        "bills": bill_list[-12:],
        "activity": activity(sub, bill_list),
        "installed": {k: inst[k] for k in ("report_id", "installed_on", "size_kw")}
        if inst
        else None,
    }
