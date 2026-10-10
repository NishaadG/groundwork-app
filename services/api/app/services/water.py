"""Water module service: readings, overnight leak check, leak events,
summary, IoT devices and meter-photo reading."""

import hashlib
import secrets
import statistics
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from app import db, storage
from app.calc.water import (
    DailyUse,
    Reading,
    anomalies,
    daily_usage,
    litres_saved,
    lpcd,
    night_flow_leak,
    stream_night_flow,
    tank_forecast,
)
from app.config import get_settings
from app.errors import ApiError
from app.services import extraction, ledger

Kind = Literal["meter", "tank"]
SERIES_DAYS = 30


class ReadingIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Kind
    value: float = Field(ge=0, le=100_000_000)
    at: datetime | None = None
    source: Literal["manual", "photo"] = "manual"


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(at: datetime | None) -> datetime:
    if at is None:
        return _now()
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def _profile(sub: str) -> dict[str, Any]:
    return db.get_profile(sub) or {}


def add_reading(
    sub: str, body: ReadingIn, source: str | None = None, device: str | None = None
) -> dict[str, Any]:
    at = _aware(body.at)
    if at > _now() + timedelta(minutes=10):
        raise ApiError(422, "future_reading", "A reading can't be in the future.")
    tank_litres = None
    if body.kind == "tank":
        if body.value > 100:
            raise ApiError(422, "bad_level", "Tank level is a percentage from 0 to 100.")
        tank_litres = _profile(sub).get("tank_litres")
        if not tank_litres:
            raise ApiError(422, "tank_size_needed", "Add your tank size in Settings first.")
    rid = uuid.uuid4().hex[:10]
    item = {
        "PK": db.user_pk(sub),
        "SK": f"WATER#{at.isoformat()}#{rid}",
        "id": rid,
        "at": at.isoformat(),
        "kind": body.kind,
        "value": body.value,
        "tank_litres": tank_litres,
        "source": source or body.source,
        "device": device,
        "created_at": db.now_iso(),
    }
    db.table().put_item(Item=db.to_dynamo({k: v for k, v in item.items() if v is not None}))
    return {k: item[k] for k in ("id", "at", "kind", "value", "source")}


def _items(sub: str, prefix: str, since: str | None = None) -> list[dict[str, Any]]:
    cond: Any = Key("PK").eq(db.user_pk(sub))
    cond = cond & (
        Key("SK").between(f"{prefix}{since}", f"{prefix}~")
        if since
        else Key("SK").begins_with(prefix)
    )
    out: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"KeyConditionExpression": cond}
    while True:
        res = db.table().query(**kwargs)
        out.extend(db.from_dynamo(i) for i in res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            return out
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _reading(item: dict[str, Any]) -> Reading:
    return Reading(
        at=datetime.fromisoformat(item["at"]),
        kind=item["kind"],
        value=item["value"],
        tank_litres=item.get("tank_litres"),
    )


# ---- Overnight leak check ----


def start_check(sub: str, body: ReadingIn) -> dict[str, Any]:
    reading = add_reading(sub, body)
    cid = uuid.uuid4().hex[:10]
    db.table().put_item(
        Item={
            "PK": db.user_pk(sub),
            "SK": f"WCHECK#{cid}",
            "id": cid,
            "status": "open",
            "kind": body.kind,
            "night_reading": reading["id"],
            "night_at": reading["at"],
            "night_value": db.to_dynamo(body.value),
            "created_at": db.now_iso(),
            "expiresAt": int((_now() + timedelta(days=3)).timestamp()),
        }
    )
    return {"id": cid, "night_at": reading["at"], "kind": body.kind}


def _typical_daily(sub: str) -> float | None:
    since = (_now() - timedelta(days=SERIES_DAYS)).isoformat()
    days = daily_usage([_reading(i) for i in _items(sub, "WATER#", since) if i["kind"] == "meter"])
    return statistics.median(d.litres for d in days) if len(days) >= 3 else None


def finish_check(sub: str, check_id: str, value: float, at: datetime | None) -> dict[str, Any]:
    pk = db.user_pk(sub)
    check = db.table().get_item(Key={"PK": pk, "SK": f"WCHECK#{check_id}"}).get("Item")
    if not check or check["status"] != "open":
        raise ApiError(404, "check_not_found", "That leak check isn't open.")
    check = db.from_dynamo(check)
    tank_litres = _profile(sub).get("tank_litres")
    night = Reading(
        at=datetime.fromisoformat(check["night_at"]),
        kind=check["kind"],
        value=check["night_value"],
        tank_litres=tank_litres,
    )
    morning_at = _aware(at)
    morning = Reading(at=morning_at, kind=check["kind"], value=value, tank_litres=tank_litres)
    try:
        result = night_flow_leak(night, morning, _typical_daily(sub))
    except ValueError as exc:
        raise ApiError(
            422,
            "check_window",
            "The morning reading needs to be 3 to 16 hours after the night one.",
        ) from exc
    add_reading(sub, ReadingIn(kind=check["kind"], value=value, at=morning_at))
    event_id = None
    if result.leak:
        event_id = uuid.uuid4().hex[:10]
        db.table().put_item(
            Item=db.to_dynamo(
                {
                    "PK": pk,
                    "SK": f"WEVENT#{morning_at.isoformat()}#{event_id}",
                    "id": event_id,
                    "type": "leak",
                    "status": "open",
                    "litres_per_day": result.litres_per_day,
                    "detected_at": morning_at.isoformat(),
                    "check": result.model_dump(),
                }
            )
        )
    db.table().update_item(
        Key={"PK": pk, "SK": f"WCHECK#{check_id}"},
        UpdateExpression="SET #s = :done, #r = :r REMOVE expiresAt",
        ExpressionAttributeNames={"#s": "status", "#r": "result"},
        ExpressionAttributeValues={":done": "done", ":r": db.to_dynamo(result.model_dump())},
    )
    return {"leak": result.leak, "result": result.model_dump(), "event_id": event_id}


def leak_events(sub: str) -> list[dict[str, Any]]:
    return [e for e in _items(sub, "WEVENT#") if e.get("type") == "leak"]


def mark_fixed(sub: str, event_id: str) -> dict[str, Any]:
    for e in _items(sub, "WEVENT#"):
        if e["id"] == event_id:
            if e["status"] == "fixed":
                return {"id": event_id, "fixed_at": e["fixed_at"]}
            fixed_at = db.now_iso()
            db.table().update_item(
                Key={"PK": db.user_pk(sub), "SK": e["SK"]},
                UpdateExpression="SET #s = :f, fixed_at = :t",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":f": "fixed", ":t": fixed_at},
            )
            return {"id": event_id, "fixed_at": fixed_at}
    raise ApiError(404, "event_not_found", "That leak isn't in your account.")


# ---- Summary ----


def _mean(days: list[DailyUse]) -> float | None:
    return sum(d.litres for d in days) / len(days) if days else None


def _savings(sub: str, event: dict[str, Any], series: list[DailyUse]) -> dict[str, Any] | None:
    """Measured litres saved for a fixed leak; posts ledger entries when counted."""
    fixed = datetime.fromisoformat(event["fixed_at"].replace("Z", "+00:00"))
    detected = datetime.fromisoformat(event["detected_at"])
    before = [d for d in series if d.day < detected.date().isoformat()][-14:]
    after = [d for d in series if d.day > fixed.date().isoformat()]
    if len(before) < 3 or len(after) < 3:
        return None
    days_since = (_now() - fixed).total_seconds() / 86400
    saved = litres_saved(
        _mean(before) or 0, _mean(after) or 0, float(event["litres_per_day"]), days_since
    )
    ref = f"WEVENT#{event['id']}"
    ledger.delete_where(sub, kind="water_leak_fix", source_ref=ref)
    if saved.counted:
        values: dict[str, float] = {"litres": saved.litres}
        rate = _profile(sub).get("water_inr_per_kl")
        if rate:
            values["inr"] = saved.litres / 1000 * float(rate)
        for metric, value in values.items():
            db.table().put_item(
                Item=db.to_dynamo(
                    {
                        "PK": db.user_pk(sub),
                        "SK": f"LEDGER#{db.now_iso()[:7]}#{uuid.uuid4().hex[:12]}",
                        "kind": "water_leak_fix",
                        "resource": "water",
                        "metric": metric,
                        "value": value,
                        "basis": "measured",
                        "period": "to_date",
                        "month": db.now_iso()[:7],
                        "source_ref": ref,
                        "created_at": db.now_iso(),
                    }
                )
            )
    return saved.model_dump()


def summary(sub: str) -> dict[str, Any]:
    profile = _profile(sub)
    since = (_now() - timedelta(days=60)).isoformat()
    raw = _items(sub, "WATER#", since)
    readings = [_reading(i) for i in raw]
    by_kind = {k: [r for r in readings if r.kind == k] for k in ("meter", "tank")}
    kind: Kind = "meter" if len(by_kind["meter"]) >= len(by_kind["tank"]) else "tank"
    series = daily_usage(by_kind[kind])
    recent = series[-SERIES_DAYS:]
    avg = _mean(recent[-7:])
    household = int(profile.get("household_size") or 0)
    lp = lpcd(avg, household).model_dump() if avg is not None and household else None
    latest_tank = next((i for i in reversed(raw) if i["kind"] == "tank"), None)
    forecast = None
    if latest_tank and profile.get("tank_litres") and avg:
        forecast = tank_forecast(
            latest_tank["value"],
            float(profile["tank_litres"]),
            avg,
            tanker_litres=profile.get("tanker_litres"),
            inr_per_tanker=profile.get("inr_per_tanker"),
        ).model_dump()
    events = []
    for e in sorted(_items(sub, "WEVENT#"), key=lambda e: e["detected_at"], reverse=True):
        out = {
            k: e.get(k)
            for k in ("id", "type", "status", "litres_per_day", "detected_at", "fixed_at")
        }
        out["working"] = e.get("check", {}).get("working")
        if e["status"] == "fixed":
            out["saved"] = _savings(sub, e, series)
        events.append(out)
    open_checks = [c for c in _items(sub, "WCHECK#") if c["status"] == "open"]
    stream = [i for i in raw if i.get("source") == "iot"]
    nights = stream_night_flow([_reading(i) for i in stream], avg)[-7:] if stream else []
    return {
        "kind": kind if readings else None,
        "series": [d.model_dump() for d in recent],
        "litres_per_day": None if avg is None else round(avg, 0),
        "lpcd": lp,
        "anomalies": [a.model_dump() for a in anomalies(series)][-5:],
        "tank": {"level_pct": latest_tank["value"], "at": latest_tank["at"]}
        if latest_tank
        else None,
        "forecast": forecast,
        "events": events,
        "open_check": {k: open_checks[-1][k] for k in ("id", "kind", "night_at")}
        if open_checks
        else None,
        "latest": [
            {k: i.get(k) for k in ("id", "at", "kind", "value", "source")} for i in raw[-10:][::-1]
        ],
        "stream": {
            "last_at": stream[-1]["at"],
            "count": len(stream),
            "nights": [n.model_dump() for n in nights],
        }
        if stream
        else None,
    }


# ---- IoT devices (simulated smart meter) ----


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def create_device(sub: str, name: str) -> dict[str, Any]:
    key = "gwd_" + secrets.token_urlsafe(24)
    did = uuid.uuid4().hex[:10]
    h = _hash(key)
    db.table().put_item(Item={"PK": f"DEVICEKEY#{h}", "SK": "META", "owner": sub, "device": did})
    db.table().put_item(
        Item={
            "PK": db.user_pk(sub),
            "SK": f"DEVICE#{did}",
            "id": did,
            "name": name,
            "key_hash": h,
            "created_at": db.now_iso(),
        }
    )
    return {"id": did, "name": name, "key": key}


def delete_devices(sub: str, device_id: str | None = None) -> int:
    n = 0
    for d in _items(sub, "DEVICE#"):
        if device_id and d["id"] != device_id:
            continue
        db.table().delete_item(Key={"PK": f"DEVICEKEY#{d['key_hash']}", "SK": "META"})
        db.table().delete_item(Key={"PK": db.user_pk(sub), "SK": d["SK"]})
        n += 1
    return n


class IngestPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: datetime
    value: float = Field(ge=0, le=100_000_000)


class IngestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    readings: list[IngestPoint] = Field(min_length=1, max_length=500)


def ingest(key: str | None, body: IngestIn) -> dict[str, Any]:
    if not key:
        raise ApiError(401, "device_key_missing", "Send the device key in X-Device-Key.")
    meta = db.table().get_item(Key={"PK": f"DEVICEKEY#{_hash(key)}", "SK": "META"}).get("Item")
    if not meta:
        raise ApiError(401, "device_key_invalid", "Unknown device key.")
    sub, device = str(meta["owner"]), str(meta["device"])
    latest_allowed = _now() + timedelta(minutes=10)
    created = db.now_iso()
    with db.table().batch_writer() as batch:
        for p in body.readings:
            at = _aware(p.at)
            if at > latest_allowed:
                raise ApiError(422, "future_reading", "A reading can't be in the future.")
            rid = uuid.uuid4().hex[:10]
            batch.put_item(
                Item=db.to_dynamo(
                    {
                        "PK": db.user_pk(sub),
                        "SK": f"WATER#{at.isoformat()}#{rid}",
                        "id": rid,
                        "at": at.isoformat(),
                        "kind": "meter",
                        "value": p.value,
                        "source": "iot",
                        "device": device,
                        "created_at": created,
                    }
                )
            )
    return {"accepted": len(body.readings)}


# ---- Meter photo ----

METER_PROMPT = (Path(__file__).parent.parent / "agents" / "prompts" / "meter_reading.md").read_text(
    encoding="utf-8"
)
METER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "whole_digits": {"type": "string"},
        "fraction_digits": {"type": "string"},
        "unit": {"type": "string", "enum": ["litres", "cubic_metres", "kilolitres", "unknown"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "evidence": {"type": ["string", "null"]},
    },
    "required": ["whole_digits", "fraction_digits", "unit", "confidence"],
}
TO_LITRES = {"litres": 1.0, "cubic_metres": 1000.0, "kilolitres": 1000.0}


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _enhanced(block: dict[str, Any]) -> dict[str, Any]:
    """A second view of the photo (contrast and sharpness lifted) for the cross-check."""
    import io

    from PIL import Image, ImageFilter, ImageOps

    img = Image.open(io.BytesIO(block["image"]["source"]["bytes"])).convert("RGB")
    img = ImageOps.autocontrast(img, cutoff=1).filter(ImageFilter.UnsharpMask(2, 150, 3))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=92)
    return {"image": {"format": "jpeg", "source": {"bytes": out.getvalue()}}}


def _read_once(block: dict[str, Any], *, second: bool = False) -> dict[str, Any]:
    model = extraction.second_opinion() if second else extraction.bedrock()
    res = model.converse(
        modelId=get_settings().vision_model_id,
        messages=[{"role": "user", "content": [block, {"text": METER_PROMPT}]}],
        toolConfig={
            "tools": [
                {
                    "toolSpec": {
                        "name": "record_meter",
                        "description": "Record the meter reading.",
                        "inputSchema": {"json": METER_SCHEMA},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": "record_meter"}},
        },
        inferenceConfig={"temperature": 0, "maxTokens": 400},
    )
    return dict(
        next(p["toolUse"]["input"] for p in res["output"]["message"]["content"] if "toolUse" in p)
    )


def read_meter_image(block: dict[str, Any]) -> dict[str, Any]:
    """Two independent reads (the photo, and an enhanced copy); the code reconciles them.

    Whole-unit digits must agree or the result is flagged `low`. Fraction digits are kept only
    when both reads agree, otherwise the reading is given to the whole unit (`medium`): a wheel
    caught between two numbers is a guess, and a guess would look like a measurement.
    """
    first = _read_once(block)
    try:
        second = _read_once(_enhanced(block), second=True)
    except Exception:
        second = None  # the first read alone cannot be cross-checked, so it can't be `high`
    unit = first.get("unit", "unknown")
    whole = _digits(first.get("whole_digits"))
    frac = _digits(first.get("fraction_digits"))
    confidence = first.get("confidence", "low")
    note = first.get("evidence")
    if second is None or second.get("unit") != unit:
        confidence = "medium" if confidence == "high" else confidence
    elif _digits(second.get("whole_digits")) != whole:
        confidence, note = (
            "low",
            f"Two reads disagreed ({whole} vs {_digits(second.get('whole_digits'))})",
        )
    elif _digits(second.get("fraction_digits")) != frac:
        frac, confidence = "", "medium"
        note = "The fraction wheels were not clear, so the reading is to the whole unit"
    if not whole or unit not in TO_LITRES:
        return {"litres": None, "unit": unit, "confidence": "low", "evidence": note}
    reading = float(whole) + (float(f"0.{frac}") if frac else 0.0)
    return {
        "litres": round(reading * TO_LITRES[unit], 1),
        "unit": unit,
        "confidence": confidence,
        "evidence": note,
    }


def read_meter_photo(sub: str, key: str) -> dict[str, Any]:
    if not storage.owns_key(sub, key) or "/meter/" not in key:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.")
    s = get_settings()
    try:
        obj = storage.s3().get_object(Bucket=s.uploads_bucket, Key=key)
    except Exception as exc:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.") from exc
    extraction.check_rate_limit(sub)
    block = extraction._image_block(obj["Body"].read(), obj.get("ContentType", "image/jpeg"))
    try:
        return read_meter_image(block)
    except Exception as exc:
        if extraction.ai_unavailable(exc):
            raise extraction.unavailable_error() from exc
        raise ApiError(502, "extraction_failed", "We couldn't read this meter.") from exc
