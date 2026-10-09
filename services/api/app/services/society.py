"""Housing societies: create or join with an invite code, a combined dashboard,
an opt-in leaderboard against each home's own baseline, and admin tools
(common tank log, announcements).

Privacy: members see society-wide sums and counts, never another member's
records. Names appear only on the leaderboard, and only for members who opt in.
"""

import secrets
import time
import uuid
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Literal

from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field

from app import db
from app.calc.report_card import BillPoint, electricity_card
from app.calc.solar import Shading, SolarInputs, calc_solar
from app.calc.tariff import BillContext, available_tariffs, load_tariff
from app.calc.working import Source, WorkingStep
from app.errors import ApiError
from app.services import home, irradiance, ledger, water

POINTER_SK = "SOCIETY"
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L
CODE_LENGTH = 8
REALISED = ("estimated", "measured")


def society_pk(society_id: str) -> str:
    if not society_id or "#" in society_id:
        raise ValueError("invalid society id")
    return f"SOCIETY#{society_id}"


class MemberFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flat_label: str | None = Field(default=None, max_length=20)
    nickname: str | None = Field(default=None, max_length=30)
    leaderboard_opt_in: bool = False


class CreateIn(MemberFields):
    name: str = Field(min_length=2, max_length=80)
    city: str = Field(min_length=2, max_length=60)
    flats: int = Field(ge=2, le=5000)


class JoinIn(MemberFields):
    code: str = Field(min_length=CODE_LENGTH, max_length=CODE_LENGTH + 2)


class MemberUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flat_label: str | None = Field(default=None, max_length=20)
    nickname: str | None = Field(default=None, max_length=30)
    leaderboard_opt_in: bool | None = None


class TankIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=40)
    level_pct: float = Field(ge=0, le=100)
    at: datetime | None = None


class AnnouncementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=500)


class CommonSolarIn(BaseModel):
    """The society's common-area meter (lifts, pumps, lighting, parking)."""

    model_config = ConfigDict(extra="forbid")

    discom: str = Field(min_length=2, max_length=40)
    supply: Literal["single", "three"] = "three"
    sanctioned_load_kw: float = Field(gt=0, le=1000)
    monthly_units: float = Field(gt=0, le=500_000)
    terrace_area_sqft: float = Field(gt=0, le=1_000_000)
    shading: Shading = "none"
    kw_already_subsidised: float = Field(default=0, ge=0, le=500)
    cost_inr: float | None = Field(default=None, gt=0, le=1_000_000_000)


# ---- Membership ----


def membership(sub: str) -> dict[str, Any] | None:
    item = db.table().get_item(Key={"PK": db.user_pk(sub), "SK": POINTER_SK}).get("Item")
    return db.from_dynamo(item) if item else None


def _require(sub: str, admin: bool = False) -> tuple[str, dict[str, Any]]:
    m = membership(sub)
    if not m:
        raise ApiError(404, "not_in_society", "You haven't joined a society.")
    meta = _meta(m["society_id"])
    if admin and meta["admin_sub"] != sub:
        raise ApiError(403, "not_admin", "Only the society admin can do that.")
    return m["society_id"], meta


def _meta(society_id: str) -> dict[str, Any]:
    item = db.table().get_item(Key={"PK": society_pk(society_id), "SK": "META"}).get("Item")
    if not item:
        raise ApiError(404, "society_not_found", "That society no longer exists.")
    meta: dict[str, Any] = db.from_dynamo(item)
    return meta


def _members(society_id: str) -> list[dict[str, Any]]:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(society_pk(society_id))
        & Key("SK").begins_with("MEMBER#")
    )
    return sorted((db.from_dynamo(i) for i in res.get("Items", [])), key=lambda m: m["joined_at"])


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _clean(v: str | None) -> str | None:
    return v.strip() or None if v else None


def _add_member(sub: str, society_id: str, f: MemberFields, role: str) -> None:
    at = db.now_iso()
    with db.table().batch_writer() as batch:
        batch.put_item(
            Item={
                "PK": society_pk(society_id),
                "SK": f"MEMBER#{sub}",
                "sub": sub,
                "flat_label": _clean(f.flat_label),
                "nickname": _clean(f.nickname),
                "leaderboard_opt_in": f.leaderboard_opt_in,
                "joined_at": at,
            }
        )
        batch.put_item(
            Item={
                "PK": db.user_pk(sub),
                "SK": POINTER_SK,
                "society_id": society_id,
                "role": role,
                "joined_at": at,
            }
        )


def create(sub: str, body: CreateIn) -> dict[str, Any]:
    if membership(sub):
        raise ApiError(409, "already_in_society", "Leave your current society first.")
    sid = uuid.uuid4().hex[:10]
    code = _new_code()
    db.table().put_item(
        Item={
            "PK": society_pk(sid),
            "SK": "META",
            "GSI1PK": f"INVITE#{code}",
            "GSI1SK": "SOCIETY",
            "id": sid,
            "name": body.name.strip(),
            "city": body.city.strip(),
            "flats": body.flats,
            "admin_sub": sub,
            "invite_code": code,
            "created_at": db.now_iso(),
        }
    )
    _add_member(sub, sid, body, "admin")
    return dashboard(sub)


def join(sub: str, body: JoinIn) -> dict[str, Any]:
    if membership(sub):
        raise ApiError(409, "already_in_society", "Leave your current society first.")
    code = body.code.strip().upper().replace("-", "").replace(" ", "")
    res = db.table().query(
        IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"INVITE#{code}")
    )
    items = res.get("Items", [])
    if not items:
        raise ApiError(404, "invite_not_found", "That invite code doesn't match a society.")
    _add_member(sub, str(items[0]["id"]), body, "member")
    return dashboard(sub)


def update_member(sub: str, body: MemberUpdate) -> dict[str, Any]:
    sid, _ = _require(sub)
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ApiError(422, "nothing_to_update", "Send at least one field to update.")
    sets, names, values = [], {}, {}
    for i, (k, v) in enumerate(fields.items()):
        sets.append(f"#f{i} = :v{i}")
        names[f"#f{i}"] = k
        values[f":v{i}"] = _clean(v) if isinstance(v, str) else v
    db.table().update_item(
        Key={"PK": society_pk(sid), "SK": f"MEMBER#{sub}"},
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    return dashboard(sub)


def leave(sub: str) -> None:
    """Leaving removes the membership only; the member's own records stay with them.
    An admin who leaves hands over to the longest-standing member, and the last
    member to leave deletes the society."""
    m = membership(sub)
    if not m:
        return
    sid = m["society_id"]
    t = db.table()
    t.delete_item(Key={"PK": society_pk(sid), "SK": f"MEMBER#{sub}"})
    t.delete_item(Key={"PK": db.user_pk(sub), "SK": POINTER_SK})
    try:
        meta = _meta(sid)
    except ApiError:
        return
    rest = _members(sid)
    if not rest:
        res = t.query(KeyConditionExpression=Key("PK").eq(society_pk(sid)))
        with t.batch_writer() as batch:
            for i in res.get("Items", []):
                batch.delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
        return
    if meta["admin_sub"] == sub:
        heir = rest[0]["sub"]
        t.update_item(
            Key={"PK": society_pk(sid), "SK": "META"},
            UpdateExpression="SET admin_sub = :s",
            ExpressionAttributeValues={":s": heir},
        )
        t.update_item(
            Key={"PK": db.user_pk(heir), "SK": POINTER_SK},
            UpdateExpression="SET #r = :a",
            ExpressionAttributeNames={"#r": "role"},
            ExpressionAttributeValues={":a": "admin"},
        )


# ---- Dashboard ----


def _energy_change(sub: str) -> dict[str, Any] | None:
    bills = home.bills(sub)
    card = electricity_card(
        [
            BillPoint(
                units=b["units_kwh"],
                period_start=date.fromisoformat(b["period_start"])
                if b.get("period_start")
                else None,
                period_end=date.fromisoformat(b["period_end"]) if b.get("period_end") else None,
            )
            for b in bills
        ]
    )
    return {"change_pct": card.change_pct, "grade": card.grade} if card else None


def _display_name(m: dict[str, Any]) -> str:
    return m.get("nickname") or m.get("flat_label") or "A household"


def dashboard(sub: str) -> dict[str, Any]:
    sid, meta = _require(sub)
    members = _members(sid)
    projected: dict[str, float] = defaultdict(float)
    realised: dict[str, float] = defaultdict(float)
    leaks_found = leaks_fixed = 0
    with_data = 0
    board: list[dict[str, Any]] = []
    hidden = 0
    for m in members:
        msub = m["sub"]
        tot = ledger.totals(msub)
        if tot["entries"]:
            with_data += 1
        for k, v in tot["projected"].items():
            projected[k] += v
        for basis in REALISED:
            for k, v in tot[basis].items():
                realised[k] += v
        for e in water.leak_events(msub):
            leaks_found += 1
            leaks_fixed += e["status"] == "fixed"
        change = _energy_change(msub)
        if m.get("leaderboard_opt_in"):
            board.append(
                {
                    "name": _display_name(m),
                    "is_you": msub == sub,
                    **(change or {"change_pct": None, "grade": None}),
                }
            )
        else:
            hidden += 1
    # Ranked by change against each home's own baseline (lower is better); homes
    # without a baseline yet go last, alphabetically.
    board.sort(key=lambda r: (r["change_pct"] is None, r["change_pct"] or 0.0, r["name"].lower()))
    me = next(m for m in members if m["sub"] == sub)
    n = len(members)
    participation = round(n / meta["flats"] * 100, 1)
    working = [
        WorkingStep(
            id="society_participation",
            label="Participation",
            formula="households on Groundwork ÷ flats in the society × 100",
            inputs={"households": n, "flats": meta["flats"]},
            result=participation,
            unit="%",
            source=Source(name="Society members, and the flat count the admin entered"),
        ).model_dump()
    ]
    for metric, (label, unit) in home.METRIC_LABELS.items():
        if realised.get(metric):
            working.append(
                WorkingStep(
                    id=f"society_{metric}",
                    label=label,
                    formula="sum of every member's realised ledger entries (estimated + measured)",
                    inputs={"households": n, "households_with_entries": with_data},
                    result=round(realised[metric], 3),
                    unit=unit,
                    source=Source(name="Members' ledgers, summed when you open this page"),
                ).model_dump()
            )
    out: dict[str, Any] = {
        "id": sid,
        "name": meta["name"],
        "city": meta["city"],
        "flats": meta["flats"],
        "invite_code": meta["invite_code"],
        "is_admin": meta["admin_sub"] == sub,
        "members": n,
        "participation_pct": participation,
        "totals": {
            "projected": {k: round(v, 3) for k, v in projected.items()},
            "realised": {k: round(v, 3) for k, v in realised.items()},
        },
        "leaks": {"found": leaks_found, "fixed": leaks_fixed},
        "leaderboard": board,
        "leaderboard_hidden": hidden,
        "me": {
            "flat_label": me.get("flat_label"),
            "nickname": me.get("nickname"),
            "leaderboard_opt_in": bool(me.get("leaderboard_opt_in")),
        },
        "common_solar": _common_solar(sid),
        "tanks": _tanks(sid),
        "announcements": _announcements(sid),
        "working": working,
    }
    return out


# ---- Admin ----


def _tanks(sid: str) -> list[dict[str, Any]]:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(society_pk(sid)) & Key("SK").begins_with("TANK#"),
        ScanIndexForward=False,
    )
    latest: dict[str, dict[str, Any]] = {}
    history: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for i in (db.from_dynamo(x) for x in res.get("Items", [])):
        key = i["name"].lower()
        if len(history[key]) < 10:
            history[key].append({"at": i["at"], "level_pct": i["level_pct"]})
        latest.setdefault(key, i)
    return [
        {
            "name": v["name"],
            "level_pct": v["level_pct"],
            "at": v["at"],
            "history": history[k],
        }
        for k, v in sorted(latest.items())
    ]


def log_tank(sub: str, body: TankIn) -> dict[str, Any]:
    sid, _ = _require(sub, admin=True)
    at = (body.at.isoformat() if body.at else None) or db.now_iso()
    if at > db.now_iso():
        raise ApiError(422, "future_time", "The reading time can't be in the future.")
    db.table().put_item(
        Item=db.to_dynamo(
            {
                "PK": society_pk(sid),
                # write time breaks ties between readings stamped in the same second
                "SK": f"TANK#{at}#{time.time_ns():020d}",
                "name": body.name.strip(),
                "level_pct": body.level_pct,
                "at": at,
            }
        )
    )
    return {"tanks": _tanks(sid)}


def _announcements(sid: str) -> list[dict[str, Any]]:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(society_pk(sid)) & Key("SK").begins_with("ANN#"),
        ScanIndexForward=False,
        Limit=5,
    )
    return [{"id": i["id"], "text": i["text"], "at": i["at"]} for i in res.get("Items", [])]


def announce(sub: str, body: AnnouncementIn) -> dict[str, Any]:
    sid, _ = _require(sub, admin=True)
    at = db.now_iso()
    aid = uuid.uuid4().hex[:8]
    db.table().put_item(
        Item={
            "PK": society_pk(sid),
            "SK": f"ANN#{at}#{aid}",
            "id": aid,
            "text": body.text.strip(),
            "at": at,
        }
    )
    return {"announcements": _announcements(sid)}


def delete_announcement(sub: str, ann_id: str) -> None:
    sid, _ = _require(sub, admin=True)
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(society_pk(sid)) & Key("SK").begins_with("ANN#")
    )
    for i in res.get("Items", []):
        if i["id"] == ann_id:
            db.table().delete_item(Key={"PK": i["PK"], "SK": i["SK"]})
            return
    raise ApiError(404, "announcement_not_found", "That announcement isn't there.")


# ---- Common-area solar ----

COMMON_SOLAR_SK = "COMMON_SOLAR"


def _common_solar(sid: str) -> dict[str, Any] | None:
    item = db.table().get_item(Key={"PK": society_pk(sid), "SK": COMMON_SOLAR_SK}).get("Item")
    if not item:
        return None
    return {k: db.from_dynamo(item[k]) for k in ("inputs", "result", "working", "updated_at")}


def common_solar(sub: str, body: CommonSolarIn) -> dict[str, Any]:
    """Rooftop solar on the society's terrace for its common-area meter. Housing
    societies' common facilities are billed on the residential tariff by every
    DISCOM we cover (see the tariff notes), with the GHS/RWA subsidy."""
    sid, meta = _require(sub, admin=True)
    if body.discom not in available_tariffs():
        raise ApiError(422, "unknown_discom", "Pick your society's electricity company.")
    profile = db.get_profile(sub) or {}
    if profile.get("lat") is None or profile.get("lng") is None:
        raise ApiError(422, "location_needed", "Add your home's location in Settings first.")
    sun, sun_source = irradiance.monthly_irradiance(float(profile["lat"]), float(profile["lng"]))
    tariff = load_tariff(body.discom)
    homes = int(meta["flats"])
    report = calc_solar(
        SolarInputs(
            irradiance_kwh_m2_day=sun,
            irradiance_source=sun_source,
            monthly_units=[body.monthly_units] * 12,
            roof_area_sqft=body.terrace_area_sqft,
            shading=body.shading,
            sanctioned_load_kw=body.sanctioned_load_kw,
            tariff=tariff,
            bill=BillContext(supply=body.supply, load_kw=body.sanctioned_load_kw),
            cost_override_inr=body.cost_inr,
            society_homes=homes,
            society_kw_already_subsidised=body.kw_already_subsidised,
        )
    )
    working = [w.model_dump() for w in report.working]
    working.insert(
        0,
        WorkingStep(
            id="common_units",
            label="Common-area use",
            formula="the common meter's average monthly units, the same every month "
            "(pumps, lifts and lighting run all year)",
            inputs={"monthly_units": body.monthly_units},
            result=round(body.monthly_units * 12, 0),
            unit="kWh/year",
            source=Source(name="Entered by the society admin from the common meter's bills"),
        ).model_dump(),
    )
    if tariff.common_area:
        working.insert(
            1,
            WorkingStep(
                id="common_tariff",
                label="Tariff for the common meter",
                formula=tariff.common_area.note,
                inputs={"discom": tariff.discom},
                result=tariff.category,
                source=Source(
                    name=tariff.common_area.source,
                    url=tariff.common_area.source_url,
                    status="verified",
                ),
            ).model_dump(),
        )
    per_home = {
        "net_cost_inr": round(report.net_cost_inr / homes, 0),
        "savings_year1_inr": round(report.savings_year1_inr / homes, 0),
    }
    result = {
        **report.model_dump(exclude={"working", "years"}),
        "homes": homes,
        "per_home": per_home,
        "tariff": f"{tariff.discom} {tariff.category}",
    }
    db.table().put_item(
        Item={
            "PK": society_pk(sid),
            "SK": COMMON_SOLAR_SK,
            "inputs": db.to_dynamo(body.model_dump()),
            "result": db.to_dynamo(result),
            "working": db.to_dynamo(working),
            "updated_at": db.now_iso(),
            "by": sub,
        }
    )
    return dashboard(sub)
