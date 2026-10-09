# ruff: noqa: E501  (answer templates and word lists read better unwrapped)
"""A rule-based copilot: recognises what the question is about and answers from the
household's own data with the same tools and cards as the model-backed copilot.

Used when the Bedrock model can't be reached, so the copilot always answers. Every number
in a reply comes from a service result, never from free text.
"""

import re
from dataclasses import dataclass, field
from typing import Any

from app import db
from app.calc.waste import materials
from app.services import ledger, waste, water
from app.services.solar_reports import get_report, list_reports


@dataclass
class Answer:
    text: str
    cards: list[dict[str, Any]] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    results: list[Any] = field(default_factory=list)


def inr(v: float) -> str:
    """₹1,23,456 (Indian grouping)."""
    n = round(v)
    s = str(abs(n))
    head, tail = s[:-3], s[-3:]
    parts: list[str] = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ("-" if n < 0 else "") + "₹" + ",".join([*parts, tail])


def num(v: float, d: int = 0) -> str:
    return f"{v:,.{d}f}"


# Words that signal each topic, in English, Hindi and Marathi
TOPICS: list[tuple[str, tuple[str, ...]]] = [
    (
        "pickup",
        (
            "pickup",
            "pick up",
            "kabadi",
            "kabaadi",
            "recycler",
            "scrap dealer",
            "collect my",
            "भंगार",
            "कबाड़",
        ),
    ),
    ("material", ()),  # matched separately against the material list
    (
        "ledger",
        (
            "saved",
            "saving",
            "savings",
            "save so far",
            "how much have i",
            "ledger",
            "impact",
            "बचत",
            "बचाया",
            "वाचव",
        ),
    ),
    (
        "water",
        (
            "water",
            "leak",
            "tank",
            "meter",
            "tap",
            "toilet",
            "tanker",
            "पानी",
            "पाणी",
            "गळती",
            "लीक",
            "टंकी",
            "टाकी",
        ),
    ),
    (
        "solar",
        (
            "solar",
            "roof",
            "panel",
            "subsidy",
            "surya",
            "electricity",
            "bill",
            "units",
            "payback",
            "सोलर",
            "सौर",
            "बिजली",
            "वीज",
            "बिल",
        ),
    ),
    ("waste", ("waste", "garbage", "trash", "recycl", "segregat", "dispose", "कचरा", "कचऱ्")),
]

# Everyday names for materials, mapped to the material ids in waste.json
SYNONYMS: dict[str, str] = {
    "pizza": "wet",
    "food": "wet",
    "vegetable": "wet",
    "peel": "wet",
    "leftover": "wet",
    "chips": "multilayer",
    "biscuit": "multilayer",
    "wrapper": "multilayer",
    "packet": "multilayer",
    "bottle": "pet",
    "pet": "pet",
    "water bottle": "pet",
    "newspaper": "newspaper",
    "paper": "mixed_paper",
    "book": "mixed_paper",
    "notebook": "mixed_paper",
    "cardboard": "cardboard",
    "carton": "cardboard",
    "box": "cardboard",
    "glass": "glass",
    "jar": "glass",
    "cans": "aluminium",
    "aluminium": "aluminium",
    "aluminum": "aluminium",
    "iron": "ferrous",
    "tin": "ferrous",
    "steel": "steel",
    "copper": "copper",
    "brass": "brass",
    "phone": "ewaste",
    "charger": "ewaste",
    "cable": "ewaste",
    "laptop": "ewaste",
    "electronic": "ewaste",
    "battery": "special_care",
    "batteries": "special_care",
    "medicine": "special_care",
    "bulb": "special_care",
    "paint": "special_care",
    "diaper": "sanitary",
    "pad": "sanitary",
    "sanitary": "sanitary",
    "clothes": "textile",
    "cloth": "textile",
    "plastic bag": "ldpe_film",
    "polythene": "ldpe_film",
    "milk pouch": "ldpe_film",
    "bucket": "hdpe",
    "detergent": "hdpe",
    # Hindi and Marathi
    "चिप्स": "multilayer",
    "पैकेट": "multilayer",
    "बोतल": "pet",
    "बाटल": "pet",
    "अख़बार": "newspaper",
    "अखबार": "newspaper",
    "वर्तमानपत्र": "newspaper",
    "पिज़्ज़ा": "wet",
    "पिझ्झा": "wet",
    "बैटरी": "special_care",
    "दवा": "special_care",
    "काँच": "glass",
    "काच": "glass",
}
# Questions about what a material is worth go to the material, even if they name a kabadiwala
PRICE_WORDS = ("pay", "price", "worth", "sell", "rate", "buy", "कितने", "किंमत")
STREAM_NAMES = {
    "wet": "wet",
    "dry": "dry",
    "sanitary": "sanitary",
    "special_care": "special-care",
    "e_waste": "e-waste",
}


def find_material(text: str) -> str | None:
    t = text.lower()
    # A greasy or food-soiled box is wet waste, not cardboard
    if "pizza" in t or "greasy" in t or "oily" in t:
        return "wet"
    for word, mid in sorted(SYNONYMS.items(), key=lambda kv: -len(kv[0])):
        # Latin words match at a word start ("can" must not match "scan"); Devanagari by substring
        found = re.search(rf"\b{re.escape(word)}", t) if word.isascii() else word in t
        if found:
            return mid
    return None


def topic(text: str) -> str:
    t = text.lower()
    # "What does a kabadiwala pay for newspaper?" is about the material, not a pickup
    if find_material(t) and any(w in t for w in PRICE_WORDS):
        return "material"
    for name, words in TOPICS:
        if name == "material":
            if find_material(t) and not any(w in t for w in ("how much have i", "saved", "बचत")):
                return "material"
            continue
        if any(w in t for w in words):
            return name
    return "help"


# ---- Answers ----


def _ledger(sub: str) -> Answer:
    t = ledger.totals(sub)
    realised: dict[str, float] = {}
    for basis in ("estimated", "measured"):
        for k, v in t[basis].items():
            realised[k] = round(realised.get(k, 0.0) + v, 3)
    card = {"type": "ledger_snapshot", "data": {"realised": realised, "projected": t["projected"]}}
    parts = []
    if realised.get("inr"):
        parts.append(f"{inr(realised['inr'])} saved")
    if realised.get("kwh"):
        parts.append(f"{num(realised['kwh'])} kWh of solar electricity")
    if realised.get("litres"):
        parts.append(f"{num(realised['litres'])} litres of water")
    if realised.get("kg"):
        parts.append(f"{num(realised['kg'], 1)} kg of waste kept out of landfill")
    if realised.get("co2_t"):
        parts.append(f"{num(realised['co2_t'] * 1000, 1)} kg of CO₂ avoided")
    if parts:
        text = (
            "So far your home has: "
            + "; ".join(parts)
            + ". Open Reports for the full impact report with every number's working."
        )
    elif t["projected"].get("inr"):
        text = f"Your latest solar report could save about {inr(t['projected']['inr'])} a year. Once you install it, or log water and waste, your ledger starts counting real savings."
    else:
        text = "Your ledger is ready to count savings. Add a bill on the Solar page, a reading on the Water page or a waste log, and they'll show up here."
    return Answer(text, [card], ["get_ledger"], [t])


def _solar(sub: str, question: str) -> Answer:
    reports = list_reports(sub)
    if not reports:
        return Answer(
            "Add your latest electricity bill on the Solar page and I'll work out the right system size for your roof, the PM Surya Ghar subsidy, what you'd pay and how fast it pays back.",
            [],
            ["get_solar_report"],
        )
    rid = reports[0]["id"]
    r = get_report(sub, rid)["report"]
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
    card = {"type": "solar_summary", "data": {**data, "id": rid}}
    if not r.get("feasible"):
        return Answer(
            "Your open roof area is too small for a 1 kW system. If you have more shadow-free space, update the roof area and I'll recalculate.",
            [card],
            ["get_solar_report"],
            [data],
        )
    text = (
        f"Your roof suits a {num(r['size_kw'], 1)} kW system. It costs about {inr(r['cost_inr'])}; "
        f"the PM Surya Ghar subsidy covers {inr(r['subsidy_inr'])}, so you'd pay {inr(r['net_cost_inr'])}. "
        f"It would make about {num(r['annual_generation_kwh'])} kWh a year and save about {inr(r['savings_year1_inr'])} in year one"
    )
    if r.get("payback_years"):
        text += f", paying for itself in about {num(r['payback_years'], 1)} years"
    text += "."
    q = question.lower()
    if "subsid" in q or "apply" in q or "surya" in q:
        text += " To apply, register on the official portal, pmsuryaghar.gov.in, and pick a vendor registered there; the subsidy reaches your bank account after installation and inspection."
    else:
        text += " Open the report to see how every figure was worked out."
    return Answer(text, [card], ["get_solar_report"], [data])


def _water(sub: str) -> Answer:
    s = water.summary(sub)
    leaks = [e for e in s["events"] if e["status"] == "open"]
    if leaks:
        e = leaks[0]
        card = {
            "type": "leak_alert",
            "data": {"litres_per_day": e["litres_per_day"], "detected_at": e["detected_at"]},
        }
        text = (
            f"Your overnight check found about {num(e['litres_per_day'])} litres a day going somewhere. "
            "Start with the toilet: put a few drops of food colouring in the cistern and see if colour reaches the bowl within 15 minutes. "
            "Then check the tank's float valve, dripping taps and damp patches on walls. Mark it fixed on the Water page and I'll count the litres saved."
        )
        return Answer(text, [card], ["get_water_summary"], [s])
    lpcd = s.get("lpcd")
    card = {
        "type": "water_summary",
        "data": {
            "litres_per_day": s["litres_per_day"],
            "lpcd": lpcd["lpcd"] if lpcd else None,
            "benchmark_lpcd": lpcd["benchmark"] if lpcd else None,
            "fixed_leaks": sum(1 for e in s["events"] if e["status"] == "fixed"),
        },
    }
    if s["litres_per_day"] is None:
        text = "To check for a leak, note your meter or tank level late at night, use no water, and read it again before anyone's up. Log both on the Water page and I'll tell you if anything is leaking."
    elif lpcd:
        text = f"Your home uses about {num(s['litres_per_day'])} litres a day, {num(lpcd['lpcd'])} litres per person against the urban benchmark of {num(lpcd['benchmark'])}. No open leaks. Run an overnight check now and then to stay sure."
    else:
        text = f"Your home uses about {num(s['litres_per_day'])} litres a day, and there are no open leaks."
    return Answer(text, [card], ["get_water_summary"], [s])


def _material(question: str) -> Answer:
    mid = find_material(question) or "other"
    m = materials()[mid]
    rate = m["rate_inr_per_kg"]
    stream = STREAM_NAMES.get(m["stream"], m["stream"])
    text = f"{m['label']} goes in {stream} waste."
    if rate and rate["max"]:
        lo, hi = rate["min"], rate["max"]
        price = f"₹{num(lo)}" if lo == hi else f"₹{num(lo)}–{num(hi)}"
        text += f" Kabadiwalas buy it, usually around {price} a kg in Pune; offers vary with quantity and condition."
    elif m["stream"] == "dry":
        text += (
            " Kabadiwalas usually don't buy it, so hand it to the municipal dry-waste collection."
        )
    if m.get("note"):
        text += " " + m["note"]
    if mid == "wet" and "pizza" in question.lower():
        text = "A greasy pizza box goes in wet waste, because food-soiled cardboard can't be recycled. A clean, dry box is cardboard and kabadiwalas buy it."
    return Answer(text, [], ["material_info"], [m])


def _waste(sub: str) -> Answer:
    s = waste.summary(sub)
    wk = s["week"]
    if wk["kg_total"]:
        pct = round(wk["kg_diverted"] / wk["kg_total"] * 100) if wk["kg_total"] else 0
        text = f"This week you've logged {num(wk['kg_total'], 1)} kg of waste, {pct}% of it kept out of landfill. Keep wet, dry, sanitary and special-care waste separate; photograph a pile on the Waste page to log more."
    else:
        text = "Homes now separate waste four ways: wet, dry, sanitary and special care, with e-waste going to authorised collectors. Photograph a pile on the Waste page and I'll help sort it, value the dry waste and request a pickup."
    return Answer(text, [], ["get_waste_summary"], [s])


def _pickup(sub: str) -> Answer:
    city = (db.get_profile(sub) or {}).get("city")
    partners = waste.partners(city)
    if partners:
        names = ", ".join(f"{p['name']} ({p['area']})" for p in partners[:3])
        text = f"Recyclers listed near you: {names}. Log your waste on the Waste page and tap “Request a pickup” to send them what you have."
    else:
        text = "Log your waste on the Waste page and tap “Request a pickup”: recyclers listed in your city receive what you have and roughly how much."
    return Answer(text, [], ["get_partners"], [partners])


HELP = (
    "I can help with your electricity, water and waste. Try: “How much have I saved?”, "
    "“Is rooftop solar worth it for my home?”, “Do I have a water leak?” or “Can I recycle a pizza box?”"
)


def answer(sub: str, question: str) -> Answer:
    kind = topic(question)
    if kind == "ledger":
        return _ledger(sub)
    if kind == "solar":
        return _solar(sub, question)
    if kind == "water":
        return _water(sub)
    if kind == "material":
        return _material(question)
    if kind == "waste":
        return _waste(sub)
    if kind == "pickup":
        return _pickup(sub)
    return Answer(HELP)
