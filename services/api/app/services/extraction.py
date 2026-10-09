"""Bill extraction: AI reads, code checks, the user confirms.

The model (Nova Lite on Bedrock, or the configured alternative) reads the photo
into a fixed JSON schema (forced tool use, temperature 0). Every value then goes
through checks in code; a failed check downgrades that field to `low` so the
confirm screen makes the user look at it.
Text read from the image is data only and never acted on.
"""

import io
import logging
import re
import time
from datetime import date
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageOps
from pydantic import BaseModel

from app import db, storage
from app.calc.tariff import BillContext, bill_total, load_tariff
from app.config import get_settings
from app.errors import ApiError
from app.services import ai

log = logging.getLogger("groundwork.extraction")

Confidence = Literal["high", "medium", "low"]
MAX_SIDE = 1600

PROMPT = (Path(__file__).parent.parent / "agents" / "prompts" / "bill_extraction.md").read_text(
    encoding="utf-8"
)


def _field(kind: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "value": {**kind, "type": [kind["type"], "null"]},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "evidence": {"type": ["string", "null"]},
        },
        "required": ["value", "confidence"],
    }


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "discom": _field({"type": "string"}),
        "consumer_category": _field({"type": "string"}),
        "consumer_name": _field({"type": "string"}),
        "billing_period_start": _field({"type": "string"}),
        "billing_period_end": _field({"type": "string"}),
        "units_consumed_kwh": _field({"type": "number"}),
        "sanctioned_load_kw": _field({"type": "number"}),
        "supply_phase": _field({"type": "string", "enum": ["single", "three"]}),
        "total_amount_inr": _field({"type": "number"}),
        "fac_amount_inr": _field({"type": "number"}),
        "history": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"month": {"type": "string"}, "units": {"type": "number"}},
                "required": ["month", "units"],
            },
        },
    },
    "required": ["discom", "units_consumed_kwh", "total_amount_inr"],
}


class Field_(BaseModel):
    value: Any = None
    confidence: Confidence = "low"
    evidence: str | None = None
    issue: str | None = None


class Extraction(BaseModel):
    discom_id: str | None
    fields: dict[str, Field_]
    history: list[dict[str, Any]]
    consumer_name_masked: str | None


# ---- Bedrock ----


def bedrock() -> Any:
    """The model client for the configured provider (Bedrock, or the Converse adapter)."""
    return ai.client()


def _image_block(data: bytes, content_type: str) -> dict[str, Any]:
    if content_type == "application/pdf":
        return {"document": {"format": "pdf", "name": "bill", "source": {"bytes": data}}}
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    except Exception as exc:
        raise ApiError(415, "unreadable_image", "We couldn't open that image.") from exc
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88)
    return {"image": {"format": "jpeg", "source": {"bytes": out.getvalue()}}}


def call_model(block: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    res = bedrock().converse(
        modelId=s.vision_model_id,
        messages=[{"role": "user", "content": [block, {"text": PROMPT}]}],
        toolConfig={
            "tools": [
                {
                    "toolSpec": {
                        "name": "record_bill",
                        "description": "Record the fields read from the electricity bill.",
                        "inputSchema": {"json": SCHEMA},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": "record_bill"}},
        },
        inferenceConfig={"temperature": 0, "maxTokens": 2000},
    )
    for part in res["output"]["message"]["content"]:
        if "toolUse" in part:
            return dict(part["toolUse"]["input"])
    raise ApiError(502, "extraction_failed", "We couldn't read this bill.")


# ---- When the AI service itself is unavailable ----

_UNAVAILABLE_HINTS = (
    "operation not allowed", "not authorized", "accessdenied", "being verified",
    "api key not valid", "permission_denied", "resource_exhausted", "high demand",
)  # fmt: skip
# Raised by the copilot's OpenAI-compatible model on key or free-tier quota problems.
_UNAVAILABLE_TYPES = ("AuthenticationError", "PermissionDeniedError", "ModelThrottledException")


def ai_unavailable(exc: BaseException | None) -> bool:
    """True when Bedrock refused the call for account reasons (model access not enabled yet),
    as opposed to a bad photo or a passing error. Walks the exception chain."""
    seen = 0
    while exc is not None and seen < 10:
        if isinstance(exc, ai.AiUnavailable) or type(exc).__name__ in _UNAVAILABLE_TYPES:
            return True
        text = f"{type(exc).__name__} {exc}".lower()
        if any(h in text for h in _UNAVAILABLE_HINTS):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


def unavailable_error() -> ApiError:
    return ApiError(503, "ai_unavailable", "Reading photos with AI isn't switched on yet.")


# ---- Rate limit (protect credits) ----


def check_rate_limit(sub: str) -> None:
    s = get_settings()
    hour = db.now_iso()[:13]
    res = db.table().update_item(
        Key={"PK": db.user_pk(sub), "SK": f"RATE#ai#{hour}"},
        UpdateExpression="ADD #n :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeNames={"#n": "n"},
        ExpressionAttributeValues={":one": 1, ":ttl": int(time.time()) + 7200},
        ReturnValues="UPDATED_NEW",
    )
    if int(res["Attributes"]["n"]) > s.ai_calls_per_hour:
        raise ApiError(429, "rate_limited", "Too many scans this hour. Try again later.")


# ---- Interpretation and checks (in code, not by the model) ----

DISCOM_ALIASES: list[tuple[str, str]] = [
    (r"msedcl|mahavitaran|maharashtra state electricity|mseb", "msedcl"),
    (r"adani", "adani-mumbai"),
    (r"tata power(?!.*delhi)|tpc-?d|tata power company", "tata-power-mumbai"),
    (r"bescom|bangalore electricity", "bescom"),
    (r"bses rajdhani|brpl", "bses-rajdhani"),
]


def match_discom(text: str | None) -> str | None:
    if not text:
        return None
    t = text.lower()
    for pattern, tariff_id in DISCOM_ALIASES:
        if re.search(pattern, t):
            return tariff_id
    return "other"


def mask_name(name: str | None) -> str | None:
    if not name:
        return None
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return " ".join(p[0] + "•" * max(len(p) - 2, 1) + (p[-1] if len(p) > 1 else "") for p in parts)


def _parse_date(v: Any) -> date | None:
    try:
        return date.fromisoformat(str(v)) if v else None
    except ValueError:
        return None


def _downgrade(f: Field_, issue: str) -> None:
    f.confidence = "low"
    f.issue = issue


def interpret(raw: dict[str, Any]) -> Extraction:
    names = [
        "discom", "consumer_category", "billing_period_start", "billing_period_end",
        "units_consumed_kwh", "sanctioned_load_kw", "supply_phase", "total_amount_inr",
        "fac_amount_inr",
    ]  # fmt: skip
    fields = {n: Field_.model_validate(raw.get(n) or {}) for n in names}
    discom_id = match_discom(fields["discom"].value)

    start = _parse_date(fields["billing_period_start"].value)
    end = _parse_date(fields["billing_period_end"].value)
    for key, parsed in (("billing_period_start", start), ("billing_period_end", end)):
        if fields[key].value is not None and parsed is None:
            fields[key].value = None
            _downgrade(fields[key], "not_a_date")
        elif parsed:
            fields[key].value = parsed.isoformat()
    if start and end:
        days = (end - start).days + 1
        if not 25 <= days <= 65:
            _downgrade(fields["billing_period_start"], "period_length")
            _downgrade(fields["billing_period_end"], "period_length")

    units = fields["units_consumed_kwh"]
    if units.value is not None and not (0 < float(units.value) <= 5000):
        _downgrade(units, "units_out_of_range")

    load = fields["sanctioned_load_kw"]
    if load.value is not None and not (0 < float(load.value) <= 200):
        _downgrade(load, "load_out_of_range")

    amount = fields["total_amount_inr"]
    if (
        discom_id not in (None, "other")
        and units.value is not None
        and amount.value is not None
        and units.confidence != "low"
    ):
        expected = bill_total(
            float(units.value),
            load_tariff(discom_id),
            BillContext(
                load_kw=float(load.value or 1), supply=fields["supply_phase"].value or "single"
            ),
        )
        if expected > 0 and abs(float(amount.value) - expected) / expected > 0.40:
            _downgrade(amount, "amount_vs_tariff")
            _downgrade(units, "amount_vs_tariff")

    history: list[dict[str, Any]] = []
    for h in raw.get("history") or []:
        m, u = str(h.get("month", "")), h.get("units")
        if (
            re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", m)
            and isinstance(u, int | float)
            and 0 <= u <= 20000
        ):
            history.append({"month": m, "units": float(u)})
    months = [h["month"] for h in history]
    history_ok = len(set(months)) == len(months)

    name_field = Field_.model_validate(raw.get("consumer_name") or {})
    return Extraction(
        discom_id=discom_id,
        fields=fields,
        history=history if history_ok else [],
        consumer_name_masked=mask_name(name_field.value),
    )


def extract_bill(sub: str, key: str) -> Extraction:
    if not storage.owns_key(sub, key) or "/bill/" not in key:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.")
    s = get_settings()
    try:
        obj = storage.s3().get_object(Bucket=s.uploads_bucket, Key=key)
    except Exception as exc:
        raise ApiError(404, "upload_not_found", "That upload isn't in your account.") from exc
    if int(obj["ContentLength"]) > s.max_upload_bytes:
        raise ApiError(413, "file_too_large", "That file is too large.")
    check_rate_limit(sub)
    block = _image_block(obj["Body"].read(), obj.get("ContentType", "image/jpeg"))
    try:
        raw = call_model(block)
    except ApiError:
        raise
    except Exception as exc:
        log.exception("bedrock extraction failed")
        if ai_unavailable(exc):
            raise unavailable_error() from exc
        raise ApiError(502, "extraction_failed", "We couldn't read this bill.") from exc
    return interpret(raw)
