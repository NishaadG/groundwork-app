"""The copilot: a Strands orchestrator with solar, water and waste specialists
("agents as tools") over the same service functions the app's pages use.

Every tool is a closure bound to the signed-in user's `sub` when the request
starts, so the model can never choose whose data it reads. Tools return compact
JSON for the model and push typed cards for the UI; numbers in replies must come
from these tool results (checked by `guard.untraced_numbers` in the eval).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from strands import Agent, tool
from strands.models import Model

from app import db
from app.calc.waste import materials
from app.errors import ApiError
from app.services import extraction, home, ledger, waste, water
from app.services.solar_reports import get_report, list_reports

PROMPTS = Path(__file__).parent / "prompts"
LANGS = {"en": "English", "hi": "Hindi (Devanagari script)", "mr": "Marathi (Devanagari script)"}
Role = Literal["orchestrator", "solar", "water", "waste"]
AttachmentKind = Literal["bill", "meter", "waste"]


def prompt(name: str, lang: str) -> str:
    text = (PROMPTS / f"copilot_{name}.md").read_text(encoding="utf-8")
    return text.replace("{lang}", LANGS.get(lang, LANGS["en"]))


@dataclass
class Attachment:
    kind: AttachmentKind
    s3_key: str


@dataclass
class Session:
    """Per-request state the tools share with the streaming route."""

    sub: str
    attachment: Attachment | None = None
    cards: list[dict[str, Any]] = field(default_factory=list)
    tool_results: list[Any] = field(default_factory=list)
    agents_used: list[str] = field(default_factory=list)

    def card(self, kind: str, data: dict[str, Any]) -> None:
        self.cards.append({"type": kind, "data": data})

    def result(self, value: dict[str, Any]) -> dict[str, Any]:
        self.tool_results.append(value)
        return value


def _r(v: Any, n: int = 0) -> Any:
    return None if v is None else round(float(v), n) if n else round(float(v))


def build(
    session: Session, lang: str, model_for: Callable[[Role], Model], history: list[dict[str, Any]]
) -> Agent:
    sub = session.sub

    # ---- shared tools ----

    @tool
    def get_profile() -> dict[str, Any]:
        """The household's details: city, household size, DISCOM, roof area, water, tank size."""
        p = db.get_profile(sub) or {}
        keys = (
            "name",
            "city",
            "household_size",
            "discom",
            "roof_area_sqft",
            "water_source",
            "tank_litres",
            "sanctioned_load_kw",
        )
        return session.result({k: p.get(k) for k in keys})

    @tool
    def get_ledger() -> dict[str, Any]:
        """What the household has saved: realised totals (estimated + measured) and projected
        totals per metric. Metrics: inr (₹ saved), kwh (solar), litres (water saved),
        kg (waste kept out of landfill), co2_t (tonnes CO₂ avoided)."""
        t = ledger.totals(sub)
        realised: dict[str, float] = {}
        for basis in ("estimated", "measured"):
            for k, v in t[basis].items():
                realised[k] = round(realised.get(k, 0.0) + v, 3)
        out = {
            "realised": realised,
            "projected_per_year": t["projected"],
            "this_month": t["this_month"],
        }
        session.card("ledger_snapshot", {"realised": realised, "projected": t["projected"]})
        return session.result(out)

    # ---- solar ----

    @tool
    def get_bills() -> dict[str, Any]:
        """The household's electricity bills (oldest first, up to 12) and its latest report card,
        which compares the latest bill with earlier ones per day of use."""
        s = home.summary(sub)
        bills = [
            {k: b.get(k) for k in ("period_start", "period_end", "units_kwh", "total_amount_inr")}
            for b in s["bills"]
        ]
        card = s["report_card"]["energy"]
        out = {
            "bills": bills,
            "report_card": None
            if not card
            else {
                k: card[k] for k in ("grade", "change_pct", "latest_per_day", "baseline_per_day")
            },
        }
        return session.result(out)

    @tool
    def get_solar_report(report_id: str = "") -> dict[str, Any]:
        """The household's rooftop solar report: system size, cost, subsidy, net cost, savings,
        payback and CO₂. Leave report_id empty for the latest report."""
        reports = list_reports(sub)
        if not reports:
            return session.result({"report": None, "note": "No solar report yet."})
        rid = report_id or reports[0]["id"]
        try:
            rep = get_report(sub, rid)
        except ApiError:
            return session.result({"report": None, "note": "That report isn't in this account."})
        r = rep["report"]
        keys = (
            "feasible",
            "size_kw",
            "cost_inr",
            "subsidy_inr",
            "net_cost_inr",
            "annual_generation_kwh",
            "savings_year1_inr",
            "payback_years",
            "co2_avoided_t_per_year",
        )
        data = {k: r.get(k) for k in keys}
        session.card("solar_summary", {**data, "id": rid})
        return session.result({"report_id": rid, "created_at": rep.get("created_at"), **data})

    @tool
    def read_attached_bill() -> dict[str, Any]:
        """Read the electricity bill photo the user attached to this message."""
        a = session.attachment
        if not a or a.kind != "bill":
            return session.result({"error": "No bill photo is attached."})
        ex = extraction.extract_bill(sub, a.s3_key)
        fields = {k: f.value for k, f in ex.fields.items()}
        unsure = [k for k, f in ex.fields.items() if f.confidence == "low"]
        session.card("bill_read", {"discom": ex.discom_id, "fields": fields, "unsure": unsure})
        return session.result({"discom": ex.discom_id, "fields": fields, "unsure_fields": unsure})

    # ---- water ----

    @tool
    def get_water_summary() -> dict[str, Any]:
        """The household's water use: litres per day, litres per person per day against the
        135 L benchmark, open leaks, tank forecast and recent unusual days."""
        s = water.summary(sub)
        open_leaks = [e for e in s["events"] if e["status"] == "open"]
        fc = s.get("forecast")
        out = {
            "has_readings": bool(s["series"]),
            "litres_per_day": s["litres_per_day"],
            "lpcd": s["lpcd"]["lpcd"] if s.get("lpcd") else None,
            "benchmark_lpcd": s["lpcd"]["benchmark"] if s.get("lpcd") else None,
            "open_leaks": [
                {"litres_per_day": e["litres_per_day"], "detected_at": e["detected_at"]}
                for e in open_leaks
            ],
            "fixed_leaks": sum(1 for e in s["events"] if e["status"] == "fixed"),
            "tank": None
            if not fc
            else {
                "days_to_empty": fc.get("days_to_empty"),
                "tankers_needed": fc.get("tankers_needed"),
            },
            "unusual_days": [a["day"] for a in s["anomalies"]],
            "overnight_check_open": bool(s.get("open_check")),
        }
        if open_leaks:
            session.card("leak_alert", out["open_leaks"][0])
        else:
            session.card(
                "water_summary",
                {k: out[k] for k in ("litres_per_day", "lpcd", "benchmark_lpcd", "fixed_leaks")},
            )
        return session.result(out)

    @tool
    def read_attached_meter() -> dict[str, Any]:
        """Read the water meter photo the user attached to this message."""
        a = session.attachment
        if not a or a.kind != "meter":
            return session.result({"error": "No meter photo is attached."})
        r = water.read_meter_photo(sub, a.s3_key)
        session.card("meter_read", r)
        return session.result(r)

    # ---- waste ----

    @tool
    def material_info(material: str) -> dict[str, Any]:
        """How to hand over one kind of waste: its stream, whether kabadiwalas buy it, the
        indicative Pune price range per kg, and a handling note. `material` is one of the ids
        returned in `known_materials` when unsure (e.g. pet, cardboard, multilayer, glass)."""
        mats = materials()
        m = mats.get(material.strip().lower())
        if not m:
            return session.result({"error": "Unknown material.", "known_materials": sorted(mats)})
        rate = m["rate_inr_per_kg"]
        return session.result(
            {
                "material": m["id"],
                "label": m["label"],
                "stream": m["stream"],
                "recyclable": m["recyclable"],
                "bought_by_kabadiwalas": bool(rate and rate["max"]),
                "inr_per_kg_range": [rate["min"], rate["max"]] if rate and rate["max"] else None,
                "note": m["note"],
            }
        )

    @tool
    def get_waste_summary() -> dict[str, Any]:
        """This week's waste logs by stream, the share kept out of landfill, and recent logs."""
        s = waste.summary(sub)
        wk = s["week"]
        return session.result(
            {
                "week_kg_by_stream": wk["kg_by_stream"],
                "week_kg_total": wk["kg_total"],
                "week_kg_diverted": wk["kg_diverted"],
                "recent_logs": [
                    {
                        "at": x["at"],
                        "kg_total": x["kg_total"],
                        "items": [i["label"] for i in x["items"]],
                    }
                    for x in s["scans"][:5]
                ],
            }
        )

    @tool
    def classify_attached_photo() -> dict[str, Any]:
        """Sort the attached waste photo into items, each with its stream and a handling tip."""
        a = session.attachment
        if not a or a.kind != "waste":
            return session.result({"error": "No waste photo is attached."})
        r = waste.classify(sub, a.s3_key)
        session.card("waste_items", r)
        return session.result(r)

    @tool
    def get_partners() -> dict[str, Any]:
        """Approved recyclers and kabadiwalas in the household's city. Demo listings are flagged."""
        city = (db.get_profile(sub) or {}).get("city")
        return session.result({"city": city, "partners": waste.partners(city)})

    # ---- agents ----

    def specialist(name: Role, description: str, tools: list[Any]) -> Any:
        agent = Agent(
            name=f"{name}_agent",
            description=description,
            model=model_for(name),
            system_prompt=prompt(name, lang),
            tools=tools,
            callback_handler=None,
        )
        return agent.as_tool(delegate=True)

    solar = specialist(
        "solar",
        "Electricity bills, tariffs, report cards and rooftop solar for this household.",
        [get_bills, get_solar_report, read_attached_bill, get_profile],
    )
    water_agent = specialist(
        "water",
        "Water use, leaks, overnight leak checks, meters and tanks for this household.",
        [get_water_summary, read_attached_meter, get_profile],
    )
    waste_agent = specialist(
        "waste",
        "Waste segregation, recycling, scrap value and pickups for this household.",
        [material_info, get_waste_summary, classify_attached_photo, get_partners],
    )
    return Agent(
        name="groundwork",
        model=model_for("orchestrator"),
        system_prompt=prompt("orchestrator", lang),
        tools=[solar, water_agent, waste_agent, get_ledger, get_profile],
        messages=history,  # type: ignore[arg-type]  # plain dicts in Strands' Message shape
        callback_handler=None,
    )
