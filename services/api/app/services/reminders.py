"""Monthly leak-check reminders by email, for households that turn them on in Settings.

Opted-in profiles carry GSI1PK = REMINDERS#leak so the daily job reads only them.
A reminder goes out when the household has logged no water reading and had no
reminder in the last REMIND_EVERY_DAYS days.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key

from app import db
from app.config import get_settings
from app.services import notify

INDEX = "REMINDERS#leak"
REMIND_EVERY_DAYS = 30


def set_subscription(sub: str, on: bool) -> None:
    key = {"PK": db.user_pk(sub), "SK": db.PROFILE_SK}
    if on:
        db.table().update_item(
            Key=key,
            UpdateExpression="SET GSI1PK = :p, GSI1SK = :s",
            ExpressionAttributeValues={":p": INDEX, ":s": sub},
        )
    else:
        db.table().update_item(Key=key, UpdateExpression="REMOVE GSI1PK, GSI1SK")


def _subscribers() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(INDEX),
    }
    while True:
        res = db.table().query(**kwargs)
        out.extend(res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            return out
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _last_reading_at(sub: str) -> str | None:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(db.user_pk(sub)) & Key("SK").begins_with("WATER#"),
        ScanIndexForward=False,
        Limit=1,
    )
    items = res.get("Items", [])
    return str(items[0]["at"]) if items else None


def body(name: str | None, site: str) -> str:
    hello = f"Hello {name}," if name else "Hello,"
    return (
        f"{hello}\n\n"
        "It's been a month: time for a quick overnight leak check.\n\n"
        "1. Tonight, after the last use, note your water meter or tank level.\n"
        "2. Use no water overnight.\n"
        "3. In the morning, before anyone uses water, note it again.\n\n"
        "Log both readings on the Water page and Groundwork will tell you if anything "
        f"is leaking: {site}/app/water\n\n"
        "You get this because leak-check reminders are on in Settings. "
        "Turn them off there any time.\n"
        "Groundwork"
    )


def send_due(now: datetime | None = None) -> dict[str, int]:
    """Send every reminder that's due. Returns counts for the logs."""
    now = now or datetime.now(UTC)
    cutoff = (now - timedelta(days=REMIND_EVERY_DAYS)).isoformat()
    site = get_settings().site_url.rstrip("/")
    sent = skipped = 0
    for p in _subscribers():
        sub = str(p["GSI1SK"])
        email = p.get("email")
        recent_reading = (_last_reading_at(sub) or "") >= cutoff
        recently_reminded = str(p.get("leak_reminder_sent_at") or "") >= cutoff
        if not email or recent_reading or recently_reminded:
            skipped += 1
            continue
        if notify.send_email(
            str(email), "Time for your monthly leak check", body(p.get("name"), site)
        ):
            db.table().update_item(
                Key={"PK": db.user_pk(sub), "SK": db.PROFILE_SK},
                UpdateExpression="SET leak_reminder_sent_at = :t",
                ExpressionAttributeValues={":t": now.isoformat()},
            )
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped}
