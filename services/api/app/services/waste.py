"""Waste module: classify a photo, value and log a scan, partner directory,
pickup requests and a weekly segregation summary."""

import hashlib
import logging
import re
import time
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from app import db, storage
from app.calc.waste import Item, materials, preset_kg, value_scan
from app.config import get_settings
from app.errors import ApiError
from app.services import extraction, ledger, notify

log = logging.getLogger("groundwork.waste")

PROMPT = (
    Path(__file__).parent.parent / "agents" / "prompts" / "waste_classification.md"
).read_text(encoding="utf-8")


def schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "material": {"type": "string", "enum": sorted(materials())},
                        "tip": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    },
                    "required": ["label", "material", "confidence"],
                },
            }
        },
        "required": ["items"],
    }


DIGIT = re.compile(r"[0-9०-९]")


def classify(sub: str, key: str) -> dict[str, Any]:
    if not storage.owns_key(sub, key) or "/waste/" not in key:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.")
    s = get_settings()
    try:
        obj = storage.s3().get_object(Bucket=s.uploads_bucket, Key=key)
    except Exception as exc:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.") from exc
    extraction.check_rate_limit(sub)
    block = extraction._image_block(obj["Body"].read(), obj.get("ContentType", "image/jpeg"))
    try:
        res = extraction.bedrock().converse(
            modelId=s.vision_model_id,
            messages=[{"role": "user", "content": [block, {"text": PROMPT}]}],
            toolConfig={
                "tools": [
                    {
                        "toolSpec": {
                            "name": "record_waste",
                            "description": "Record the waste items seen.",
                            "inputSchema": {"json": schema()},
                        }
                    }
                ],
                "toolChoice": {"tool": {"name": "record_waste"}},
            },
            inferenceConfig={"temperature": 0, "maxTokens": 800},
        )
        raw = next(
            p["toolUse"]["input"] for p in res["output"]["message"]["content"] if "toolUse" in p
        )
    except Exception as exc:
        log.exception("waste classification failed")
        if extraction.ai_unavailable(exc):
            raise extraction.unavailable_error() from exc
        raise ApiError(502, "extraction_failed", "We couldn't sort this photo.") from exc
    mats = materials()
    items = []
    for it in (raw.get("items") or [])[:12]:
        material = it.get("material") if it.get("material") in mats else "other"
        m = mats[material]
        tip = str(it.get("tip") or "")
        items.append(
            {
                "label": str(it.get("label") or m["label"])[:60],
                "material": material,
                "stream": m["stream"],
                "recyclable": m["recyclable"],
                # tips from the model may not contain numbers; fall back to our own note
                "tip": m["note"] if (not tip or DIGIT.search(tip)) else tip[:200],
                "confidence": it.get("confidence")
                if it.get("confidence") in ("high", "medium", "low")
                else "low",
            }
        )
    return {"items": items}


# ---- Scans ----


class ScanItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material: str
    label: str | None = Field(default=None, max_length=60)
    kg: float | None = Field(default=None, gt=0, le=1000)
    size: Literal["handful", "bag", "sack"] | None = None


class ScanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ScanItemIn] = Field(min_length=1, max_length=20)
    s3_key: str | None = None


def save_scan(sub: str, body: ScanIn) -> dict[str, Any]:
    mats = materials()
    priced: list[Item] = []
    any_preset = False
    for it in body.items:
        if it.material not in mats:
            raise ApiError(422, "unknown_material", "Choose a material from the list.")
        if it.kg is None and it.size is None:
            raise ApiError(422, "weight_needed", "Add a weight or pick a size for each item.")
        any_preset = any_preset or it.kg is None
        kg = it.kg if it.kg is not None else preset_kg(it.size)  # type: ignore[arg-type]
        priced.append(Item(material=it.material, kg=kg))
    value = value_scan(priced)
    sid = uuid.uuid4().hex[:10]
    at = db.now_iso()
    item = {
        "PK": db.user_pk(sub),
        "SK": f"WASTE#{at}#{sid}",
        "id": sid,
        "at": at,
        "items": [
            {**v.model_dump(), "label": body.items[i].label or v.label, "size": body.items[i].size}
            for i, v in enumerate(value.items)
        ],
        "kg_total": value.kg_total,
        "kg_diverted": value.kg_diverted,
        "inr_min": value.inr_min,
        "inr_max": value.inr_max,
        "co2_t": value.co2_t,
        "working": [w.model_dump() for w in value.working],
    }
    db.table().put_item(Item=db.to_dynamo(item))
    month = at[:7]
    ref = f"WASTE#{sid}"
    with db.table().batch_writer() as batch:
        for metric, val, basis in (
            ("kg", value.kg_diverted, "estimated" if any_preset else "measured"),
            ("co2_t", value.co2_t, "estimated"),
        ):
            if val > 0:
                batch.put_item(
                    Item=db.to_dynamo(
                        {
                            "PK": db.user_pk(sub),
                            "SK": f"LEDGER#{month}#{uuid.uuid4().hex[:12]}",
                            "kind": "waste_scan",
                            "resource": "waste",
                            "metric": metric,
                            "value": val,
                            "basis": basis,
                            "period": "once",
                            "month": month,
                            "source_ref": ref,
                            "created_at": at,
                        }
                    )
                )
    return {k: v for k, v in item.items() if k not in ("PK", "SK")}


def delete_scan(sub: str, scan_id: str) -> None:
    for s in _scans(sub):
        if s["id"] == scan_id:
            db.table().delete_item(Key={"PK": db.user_pk(sub), "SK": s["SK"]})
            ledger.delete_where(sub, kind="waste_scan", source_ref=f"WASTE#{scan_id}")
            return
    raise ApiError(404, "scan_not_found", "That scan isn't in your account.")


def _scans(sub: str, since: str | None = None) -> list[dict[str, Any]]:
    cond = Key("PK").eq(db.user_pk(sub)) & (
        Key("SK").between(f"WASTE#{since}", "WASTE#~") if since else Key("SK").begins_with("WASTE#")
    )
    res = db.table().query(KeyConditionExpression=cond, ScanIndexForward=False)
    return [db.from_dynamo(i) for i in res.get("Items", [])]


# Coaching tips in priority order; the text lives in the web app's messages (waste.coach.tips).
def all_scans(sub: str) -> list[dict[str, Any]]:
    return _scans(sub)


COACH_TIPS = ("multilayer", "cardboard", "ldpe_film", "glass", "ewaste", "special_care")


def summary(sub: str) -> dict[str, Any]:
    week_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    scans = _scans(sub)
    week = [s for s in scans if s["at"] >= week_ago]
    mats = materials()
    by_stream: dict[str, float] = defaultdict(float)
    diverted = 0.0
    seen: set[str] = set()
    for s in week:
        for it in s["items"]:
            by_stream[it["stream"]] += it["kg"]
            seen.add(it["material"])
            m = mats.get(it["material"])
            if m and (m["recyclable"] or it["material"] == "wet"):
                diverted += it["kg"]
    # The web app holds the tip text (so it can be translated); the API names which one applies.
    tip = next((m for m in COACH_TIPS if m in seen), None)
    return {
        "scans": [
            {
                k: s[k]
                for k in (
                    "id",
                    "at",
                    "items",
                    "kg_total",
                    "kg_diverted",
                    "inr_min",
                    "inr_max",
                    "co2_t",
                    "working",
                )
            }
            for s in scans[:20]
        ],
        "week": {
            "kg_by_stream": {k: round(v, 2) for k, v in by_stream.items()},
            "kg_total": round(sum(by_stream.values()), 2),
            "kg_diverted": round(diverted, 2),
            "tip": tip,
        },
    }


# ---- Partners and pickups ----


class PartnerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=80)
    area: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=60)
    materials: list[str] = Field(min_length=1, max_length=20)
    phone: str = Field(pattern=r"^\+?[0-9 ]{8,16}$")
    email: str | None = Field(default=None, max_length=120)


PARTNER_APPLICATIONS_PER_HOUR = 5


def check_signup_limit(ip: str) -> None:
    """The public sign-up form allows a few applications per address per hour. The address
    is stored only as a salted hash, and the counter expires after two hours."""
    digest = hashlib.sha256(f"groundwork-partners:{ip}".encode()).hexdigest()[:24]
    hour = db.now_iso()[:13]
    res = db.table().update_item(
        Key={"PK": f"RATEIP#{digest}", "SK": f"partner#{hour}"},
        UpdateExpression="ADD #n :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeNames={"#n": "n"},
        ExpressionAttributeValues={":one": 1, ":ttl": int(time.time()) + 7200},
        ReturnValues="UPDATED_NEW",
    )
    if int(res["Attributes"]["n"]) > PARTNER_APPLICATIONS_PER_HOUR:
        raise ApiError(429, "rate_limited", "Too many applications from here. Try again later.")


def partner_signup(body: PartnerIn) -> dict[str, Any]:
    mats = materials()
    if any(m not in mats for m in body.materials):
        raise ApiError(422, "unknown_material", "Choose materials from the list.")
    pid = uuid.uuid4().hex[:10]
    db.table().put_item(
        Item={
            "PK": f"PARTNER#{pid}",
            "SK": "META",
            "GSI1PK": "PARTNERS",
            "GSI1SK": f"pending#{pid}",
            "id": pid,
            **body.model_dump(),
            "status": "pending",
            "is_demo": False,
            "created_at": db.now_iso(),
        }
    )
    return {"id": pid, "status": "pending"}


def partners(city: str | None = None) -> list[dict[str, Any]]:
    res = db.table().query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq("PARTNERS")
        & Key("GSI1SK").begins_with("approved#"),
    )
    out = []
    for p in (db.from_dynamo(i) for i in res.get("Items", [])):
        if city and p["city"].lower() != city.lower():
            continue
        out.append(
            {k: p.get(k) for k in ("id", "name", "area", "city", "materials", "phone", "is_demo")}
        )
    return sorted(out, key=lambda p: (p["is_demo"], p["name"]))


class PickupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    partner_id: str
    scan_id: str
    preferred_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    note: str | None = Field(default=None, max_length=300)


def request_pickup(sub: str, email: str | None, body: PickupIn) -> dict[str, Any]:
    p = db.table().get_item(Key={"PK": f"PARTNER#{body.partner_id}", "SK": "META"}).get("Item")
    if not p or p.get("status") != "approved":
        raise ApiError(404, "partner_not_found", "That recycler isn't listed.")
    partner = db.from_dynamo(p)
    scan = next((s for s in _scans(sub) if s["id"] == body.scan_id), None)
    if not scan:
        raise ApiError(404, "scan_not_found", "That scan isn't in your account.")
    pickup_id = uuid.uuid4().hex[:10]
    at = db.now_iso()
    summary_line = ", ".join(f"{i['label']} ({i['kg']:g} kg)" for i in scan["items"])
    record = {
        "id": pickup_id,
        "partner_id": body.partner_id,
        "scan_id": body.scan_id,
        "preferred_date": body.preferred_date,
        "items": summary_line,
        "status": "requested",
        "created_at": at,
    }
    db.table().put_item(
        Item=db.to_dynamo({"PK": db.user_pk(sub), "SK": f"PICKUP#{at}#{pickup_id}", **record})
    )
    db.table().put_item(
        Item=db.to_dynamo(
            {
                "PK": f"PARTNER#{body.partner_id}",
                "SK": f"PICKUP#{at}#{pickup_id}",
                **record,
                "note": body.note,
            }
        )
    )
    emailed = False
    if partner.get("email") and not partner.get("is_demo"):
        emailed = notify.send_email(
            partner["email"],
            "Groundwork: pickup request",
            f"A household has asked for a pickup on {body.preferred_date}.\nItems: {summary_line}\n"
            f"Note: {body.note or '-'}\nReply to: {email or 'via the Groundwork app'}",
        )
    return {
        **record,
        "emailed": emailed,
        "partner": {
            "name": partner["name"],
            "phone": partner["phone"],
            "is_demo": partner["is_demo"],
        },
    }
