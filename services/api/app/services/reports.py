"""Reports: solar reports, the monthly report-card history, and the impact report
(the household's ledger with its working, what was done, and every source used)."""

from datetime import date
from typing import Any

from app import db
from app.calc.report_card import BillPoint, electricity_card
from app.calc.waste import data as waste_data
from app.data.constants import get as constant
from app.services import home, ledger, waste, water
from app.services.solar_reports import list_reports

# Constants an impact report can rest on, in the order they're listed
IMPACT_CONSTANTS = (
    "grid_emission_factor",
    "pm_surya_ghar_subsidy",
    "solar_cost_benchmark",
    "performance_ratio",
    "urban_water_benchmark_lpcd",
    "waste_streams",
)


def _point(b: dict[str, Any]) -> BillPoint:
    return BillPoint(
        units=b["units_kwh"],
        period_start=date.fromisoformat(b["period_start"]) if b.get("period_start") else None,
        period_end=date.fromisoformat(b["period_end"]) if b.get("period_end") else None,
    )


def card_history(bills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One report card per bill: that bill against the bills before it (newest first)."""
    dated = sorted(
        (b for b in bills if b.get("period_start") and b.get("period_end")),
        key=lambda b: str(b["period_end"]),
    )
    out = []
    for i in range(1, len(dated)):
        card = electricity_card([_point(b) for b in dated[: i + 1]])
        if card:
            out.append(
                {
                    "bill_id": dated[i]["id"],
                    "period_end": dated[i]["period_end"],
                    **card.model_dump(),
                }
            )
    return list(reversed(out))


def sources() -> list[dict[str, Any]]:
    out = []
    for key in IMPACT_CONSTANTS:
        c = constant(key)
        out.append(
            {
                "label": c.label,
                "source": c.source,
                "url": c.source_url,
                "as_of": c.as_of,
                "status": c.status,
            }
        )
    w = waste_data()
    out += [
        {
            "label": "Solar irradiance",
            "source": "NASA POWER climatology for your roof's location (cached per 0.1° cell)",
            "url": "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
            "as_of": None,
            "status": "verified",
        },
        {
            "label": "CO₂ avoided by recycling and composting",
            "source": w["co2_source"],
            "url": w["co2_source_url"],
            "as_of": None,
            "status": "verified",
        },
        {
            "label": "Scrap prices (shown, never counted as savings)",
            "source": w["rates_source"],
            "url": None,
            "as_of": w["rates_as_of"],
            "status": "estimate",
        },
    ]
    return out


def overview(sub: str, email: str | None) -> dict[str, Any]:
    profile = db.get_profile(sub) or {}
    bill_list = home.bills(sub)
    entries = ledger.entries(sub)
    totals = ledger.totals(sub)
    inst = home.installed(sub)
    leaks = water.leak_events(sub)
    scans = waste.all_scans(sub)
    solar = list_reports(sub)
    first = min((str(e.get("created_at") or "") for e in entries), default="") or None
    return {
        "solar_reports": solar,
        "cards": card_history(bill_list),
        "impact": {
            "name": profile.get("name") or email,
            "city": profile.get("city"),
            "generated_at": db.now_iso(),
            "since": first,
            "ledger": {k: totals[k] for k in ("projected", "estimated", "measured")},
            "working": home.ledger_working(sub, totals, inst),
            "activity": {
                "bills": len(bill_list),
                "solar_reports": len(solar),
                "installed": {k: inst[k] for k in ("installed_on", "size_kw")} if inst else None,
                "leaks_found": len(leaks),
                "leaks_fixed": sum(1 for e in leaks if e["status"] == "fixed"),
                "waste_scans": len(scans),
                "waste_kg": round(sum(float(s["kg_total"]) for s in scans), 2),
                "waste_kg_diverted": round(sum(float(s["kg_diverted"]) for s in scans), 2),
            },
            "sources": sources(),
        },
    }
