"""DynamoDB single-table access. Every key is scoped to USER#<sub>,
where `sub` always comes from the verified token."""

from datetime import UTC, datetime
from decimal import Decimal
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from app.config import get_settings


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def user_pk(sub: str) -> str:
    if not sub or "#" in sub:
        raise ValueError("invalid sub")
    return f"USER#{sub}"


def to_dynamo(value: Any) -> Any:
    """DynamoDB needs Decimal, not float."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: to_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_dynamo(v) for v in value]
    return value


def from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {k: from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [from_dynamo(v) for v in value]
    return value


@cache
def _table() -> Any:
    s = get_settings()
    return boto3.resource("dynamodb", region_name=s.aws_region).Table(s.table_name)


def table() -> Any:
    return _table()


def reset_clients() -> None:
    """For tests: drop cached boto3 resources after settings change."""
    _table.cache_clear()


PROFILE_SK = "PROFILE"
_KEY_ATTRS = {"PK", "SK", "GSI1PK", "GSI1SK", "expiresAt"}


def get_profile(sub: str) -> dict[str, Any] | None:
    item = table().get_item(Key={"PK": user_pk(sub), "SK": PROFILE_SK}).get("Item")
    if not item:
        return None
    return {k: from_dynamo(v) for k, v in item.items() if k not in _KEY_ATTRS}


def upsert_profile(sub: str, fields: dict[str, Any], email: str | None) -> dict[str, Any]:
    """Merge `fields` into the profile, creating it on first write."""
    ts = now_iso()
    names: dict[str, str] = {"#updated_at": "updated_at", "#created_at": "created_at"}
    values: dict[str, Any] = {":updated_at": ts, ":created_at": ts}
    sets = ["#updated_at = :updated_at", "#created_at = if_not_exists(#created_at, :created_at)"]
    removes: list[str] = []
    if email:
        names["#email"] = "email"
        values[":email"] = email
        sets.append("#email = :email")
    for i, (name, value) in enumerate(sorted(fields.items())):
        names[f"#f{i}"] = name
        if value is None:
            removes.append(f"#f{i}")
        else:
            values[f":f{i}"] = to_dynamo(value)
            sets.append(f"#f{i} = :f{i}")
    expr = "SET " + ", ".join(sets) + (" REMOVE " + ", ".join(removes) if removes else "")
    res = table().update_item(
        Key={"PK": user_pk(sub), "SK": PROFILE_SK},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )
    return {k: from_dynamo(v) for k, v in res["Attributes"].items() if k not in _KEY_ATTRS}


def user_items(sub: str) -> list[dict[str, Any]]:
    """Every item under the user's partition (for export and delete)."""
    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"KeyConditionExpression": Key("PK").eq(user_pk(sub))}
    while True:
        res = table().query(**kwargs)
        items.extend(res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            return items
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def delete_user_items(sub: str) -> int:
    items = user_items(sub)
    with table().batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
    return len(items)
