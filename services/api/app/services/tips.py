"""Personalised bill tips for a solar report.

AI explains, code calculates: the model writes three tips with no
numbers in them; code rejects any tip containing a digit. The one figure shown
beside the tips (₹ saved per unit cut at the top slab) is computed here.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app import db
from app.calc.tariff import BillContext, Tariff, marginal_rate
from app.config import get_settings
from app.errors import ApiError
from app.services import extraction
from app.services.solar_reports import get_report

log = logging.getLogger("groundwork.tips")

PROMPT = (Path(__file__).parent.parent / "agents" / "prompts" / "bill_tips.md").read_text(
    encoding="utf-8"
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "body": {"type": "string"}},
                "required": ["title", "body"],
            },
        }
    },
    "required": ["tips"],
}

DIGIT = re.compile(r"[0-9०-९]")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


class Tip(BaseModel):
    title: str = Field(min_length=3, max_length=80)
    body: str = Field(min_length=10, max_length=320)


class Tips(BaseModel):
    tips: list[Tip]
    rupees_per_unit_cut: float
    top_slab: str
    generated_by: str


def facts_for(report: dict[str, Any]) -> tuple[dict[str, Any], float, str]:
    inputs = report["inputs"]
    tariff = Tariff.model_validate(inputs["tariff"])
    ctx = BillContext.model_validate(inputs["bill_context"])
    units = inputs["monthly_units"]
    avg = sum(units) / 12
    rate = round(marginal_rate(avg, tariff, ctx), 2)
    lower = 0.0
    top = "all units"
    for slab in tariff.slabs:
        if slab.upto_units is None or avg <= slab.upto_units:
            top = (
                f"above {lower:.0f} units"
                if slab.upto_units is None
                else f"{lower + 1:.0f} to {slab.upto_units:.0f} units"
            )
            if lower == 0 and slab.upto_units is None:
                top = "a single rate for all units"
            break
        lower = slab.upto_units
    peak_month = MONTHS[max(range(12), key=lambda i: units[i])]
    facts = {
        "discom": tariff.discom,
        "average_monthly_units_band": top,
        "slabs_are_telescopic": tariff.slab_mode == "telescopic",
        "connection": ctx.supply,
        "sanctioned_load_kw": ctx.load_kw,
        "highest_use_month": peak_month if inputs.get("months_from_data", 0) > 1 else "unknown",
        "fixed_charge_depends_on_units": tariff.fixed_charge.mode == "by_units",
    }
    return facts, rate, top


def clean(raw: dict[str, Any]) -> list[Tip]:
    out: list[Tip] = []
    for t in raw.get("tips") or []:
        title, body = str(t.get("title", "")).strip(), str(t.get("body", "")).strip()
        if DIGIT.search(title) or DIGIT.search(body):
            log.info("dropped a tip containing a number")
            continue
        try:
            out.append(Tip(title=title, body=body))
        except ValueError:
            continue
    return out[:3]


def call_model(facts: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    res = extraction.bedrock().converse(
        modelId=s.text_model_id,
        system=[{"text": PROMPT}],
        messages=[{"role": "user", "content": [{"text": "Facts:\n" + json.dumps(facts)}]}],
        toolConfig={
            "tools": [
                {
                    "toolSpec": {
                        "name": "record_tips",
                        "description": "Record three bill-saving tips.",
                        "inputSchema": {"json": SCHEMA},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": "record_tips"}},
        },
        inferenceConfig={"temperature": 0.3, "maxTokens": 800},
    )
    for part in res["output"]["message"]["content"]:
        if "toolUse" in part:
            return dict(part["toolUse"]["input"])
    return {}


def tips_for_report(sub: str, report_id: str) -> Tips:
    report = get_report(sub, report_id)
    if report.get("tips"):
        return Tips.model_validate(report["tips"])
    facts, rate, top = facts_for(report)
    extraction.check_rate_limit(sub)
    try:
        tips = clean(call_model(facts))
    except Exception as exc:
        log.exception("tips generation failed")
        raise ApiError(502, "tips_unavailable", "Tips are unavailable right now.") from exc
    if not tips:
        raise ApiError(502, "tips_unavailable", "Tips are unavailable right now.")
    result = Tips(
        tips=tips,
        rupees_per_unit_cut=rate,
        top_slab=top,
        generated_by=get_settings().text_model_id,
    )
    db.table().update_item(
        Key={"PK": db.user_pk(sub), "SK": f"SOLAR#{report_id}"},
        UpdateExpression="SET tips = :t",
        ExpressionAttributeValues={":t": db.to_dynamo(result.model_dump())},
    )
    return result
