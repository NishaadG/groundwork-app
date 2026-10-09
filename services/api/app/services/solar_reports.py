"""Bills and solar reports: confirmed bill → monthly profile → tariff → calc → stored report."""

import secrets
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from boto3.dynamodb.conditions import Key
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app import db
from app.calc.bill import HistoryPoint, monthly_profile
from app.calc.solar import SolarInputs, calc_solar
from app.calc.tariff import (
    BillContext,
    FixedCharge,
    NetMetering,
    Slab,
    Tariff,
    available_tariffs,
    check_bill,
    load_tariff,
)
from app.errors import ApiError
from app.services import irradiance, ledger

Confidence = Literal["high", "medium", "low"]


class BillIn(BaseModel):
    """A bill the user has confirmed (typed in, or read from a photo and checked)."""

    model_config = ConfigDict(extra="forbid")

    discom: str
    units_kwh: float = Field(gt=0, le=20_000)
    period_start: date | None = None
    period_end: date | None = None
    total_amount_inr: float | None = Field(default=None, ge=0, le=10_000_000)
    sanctioned_load_kw: float | None = Field(default=None, gt=0, le=200)
    supply: Literal["single", "three"] = "single"
    charges: dict[str, float] = Field(default_factory=dict)
    history: list[HistoryPoint] = Field(default_factory=list, max_length=24)
    source: Literal["manual", "photo"] = "manual"
    s3_key: str | None = None
    confidence: dict[str, Confidence] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> "BillIn":
        if self.discom != "other" and self.discom not in available_tariffs():
            raise ValueError("unknown DISCOM")
        if self.discom == "other" and not self.total_amount_inr:
            raise ValueError("total_amount_inr is needed when the DISCOM isn't listed")
        if self.period_start and self.period_end:
            days = (self.period_end - self.period_start).days + 1
            if not 1 <= days <= 400:
                raise ValueError("billing period looks wrong")
        if self.discom != "other":
            allowed = {b.id for b in load_tariff(self.discom).bill_inputs}
            unknown = set(self.charges) - allowed
            if unknown:
                raise ValueError(f"unknown charges for this DISCOM: {sorted(unknown)}")
        for v in self.charges.values():
            if not 0 <= v <= 100:
                raise ValueError("charge values look wrong")
        return self


class Roof(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lat: float = Field(ge=6, le=38)  # India
    lng: float = Field(ge=68, le=98)
    roof_area_sqft: float = Field(gt=0, le=200_000)
    shading: Literal["none", "partial", "heavy"] = "none"


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    size_kw: float | None = Field(default=None, ge=1, le=100)
    cost_inr: float | None = Field(default=None, gt=0, le=10_000_000)
    tariff_escalation: float | None = Field(default=None, ge=0, le=0.08)


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    bill_id: str
    roof: Roof
    scenario: Scenario = Field(default_factory=Scenario)


def new_id() -> str:
    return datetime.now(UTC).strftime("%Y%m%d%H%M%S") + uuid.uuid4().hex[:6]


def own_rate_tariff(bill: BillIn) -> Tariff:
    """Unlisted DISCOM: price every unit at the bill's own average rate (less precise)."""
    assert bill.total_amount_inr is not None
    rate = bill.total_amount_inr / bill.units_kwh
    return Tariff(
        id="own-bill-rate",
        discom="Your DISCOM",
        name="Average rate from your bill",
        state="",
        category="Residential",
        fy="from your bill",
        effective_from=(bill.period_end or date.today()).isoformat(),
        effective_to="open",
        source=(
            f"Average rate from your own bill: ₹{bill.total_amount_inr:,.0f} ÷ "
            f"{bill.units_kwh:,.0f} units. Less precise than a full tariff, because it "
            "ignores slabs and fixed charges."
        ),
        source_url="https://pmsuryaghar.gov.in/",
        billing_cycle_days=30,
        slab_mode="telescopic",
        slabs=[Slab(upto_units=None, energy_inr_per_kwh=round(rate, 4))],
        fixed_charge=FixedCharge(mode="per_connection", single_phase_inr=0),
        notes=["We don't have this DISCOM's tariff yet, so savings use your average rate."],
        net_metering=NetMetering(
            allowed=True,
            max_kw_rule="sanctioned_load",
            surplus="monthly_settlement",
            note="Extra units are counted as ₹0.",
        ),
    )


def tariff_for(bill: BillIn) -> Tariff:
    return own_rate_tariff(bill) if bill.discom == "other" else load_tariff(bill.discom)


def save_bill(sub: str, bill: BillIn) -> dict[str, Any]:
    bill_id = new_id()
    month = (bill.period_end or date.today()).strftime("%Y-%m")
    item = {
        "PK": db.user_pk(sub),
        "SK": f"BILL#{month}#{bill_id}",
        "GSI1PK": f"BILLID#{sub}#{bill_id}",
        "GSI1SK": "BILL",
        "id": bill_id,
        **bill.model_dump(mode="json"),
        "created_at": db.now_iso(),
    }
    db.table().put_item(Item=db.to_dynamo(item))
    return {"id": bill_id, **bill.model_dump(mode="json")}


def get_bill(sub: str, bill_id: str) -> BillIn:
    res = db.table().query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"BILLID#{sub}#{bill_id}"),
    )
    items = res.get("Items", [])
    if not items:
        raise ApiError(404, "bill_not_found", "That bill isn't in your account.")
    raw = db.from_dynamo(items[0])
    fields = {k: raw[k] for k in BillIn.model_fields if k in raw}
    return BillIn.model_validate(fields)


def build_report(bill: BillIn, roof: Roof, scenario: Scenario) -> dict[str, Any]:
    tariff = tariff_for(bill)
    profile = monthly_profile(bill.units_kwh, bill.period_start, bill.period_end, bill.history)
    sun, sun_source = irradiance.monthly_irradiance(roof.lat, roof.lng)
    ctx = BillContext(
        supply=bill.supply, load_kw=bill.sanctioned_load_kw or 1.0, inputs=bill.charges
    )
    report = calc_solar(
        SolarInputs(
            irradiance_kwh_m2_day=sun,
            irradiance_source=sun_source,
            monthly_units=profile.monthly_units,
            roof_area_sqft=roof.roof_area_sqft,
            shading=roof.shading,
            sanctioned_load_kw=bill.sanctioned_load_kw,
            tariff=tariff,
            bill=ctx,
            tariff_escalation=scenario.tariff_escalation,
            cost_override_inr=scenario.cost_inr,
            size_override_kw=scenario.size_kw,
        )
    )
    working = [w.model_dump() for w in report.working]
    working.insert(0, profile.working.model_dump())
    bill_check = None
    if bill.total_amount_inr and bill.discom != "other":
        per_month_units = bill.units_kwh
        check = check_bill(per_month_units, bill.total_amount_inr, tariff, ctx)
        days = (
            (bill.period_end - bill.period_start).days + 1
            if bill.period_start and bill.period_end
            else None
        )
        # The tariff is monthly; a check only makes sense for a roughly monthly bill
        if days is None or 25 <= days <= 35:
            bill_check = check.model_dump()
    return {
        "report": report.model_dump(exclude={"working"}),
        "working": working,
        "bill_check": bill_check,
        "inputs": {
            "irradiance_kwh_m2_day": sun,
            "irradiance_source": sun_source,
            "monthly_units": profile.monthly_units,
            "months_from_data": profile.months_from_data,
            "roof": roof.model_dump(),
            "bill_context": ctx.model_dump(),
            "scenario": scenario.model_dump(),
            "tariff": tariff.model_dump(),
        },
    }


def create_report(sub: str, body: "ReportIn") -> dict[str, Any]:
    bill = get_bill(sub, body.bill_id)
    built = build_report(bill, body.roof, body.scenario)
    report_id = new_id()
    item = {
        "PK": db.user_pk(sub),
        "SK": f"SOLAR#{report_id}",
        "id": report_id,
        "bill_id": body.bill_id,
        "discom": bill.discom,
        "created_at": db.now_iso(),
        **built,
    }
    db.table().put_item(Item=db.to_dynamo(item))
    r = built["report"]
    if r["feasible"]:
        ledger.replace_projection(
            sub,
            kind="solar",
            source_ref=f"SOLAR#{report_id}",
            resource="energy",
            values={
                "inr": r["savings_year1_inr"],
                "kwh": r["annual_generation_kwh"],
                "co2_t": r["co2_avoided_t_per_year"],
            },
        )
    return _public_item(item)


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v for k, v in db.from_dynamo(item).items() if k not in ("PK", "SK", "GSI1PK", "GSI1SK")
    }


def get_report(sub: str, report_id: str) -> dict[str, Any]:
    item = db.table().get_item(Key={"PK": db.user_pk(sub), "SK": f"SOLAR#{report_id}"}).get("Item")
    if not item:
        raise ApiError(404, "report_not_found", "That report isn't in your account.")
    return _public_item(item)


def list_reports(sub: str) -> list[dict[str, Any]]:
    res = db.table().query(
        KeyConditionExpression=Key("PK").eq(db.user_pk(sub)) & Key("SK").begins_with("SOLAR#"),
        ScanIndexForward=False,
    )
    out = []
    for i in res.get("Items", []):
        it = db.from_dynamo(i)
        r = it["report"]
        out.append(
            {
                "id": it["id"],
                "created_at": it["created_at"],
                "discom": it.get("discom"),
                "size_kw": r["size_kw"],
                "net_cost_inr": r["net_cost_inr"],
                "savings_year1_inr": r["savings_year1_inr"],
                "payback_years": r["payback_years"],
                "feasible": r["feasible"],
            }
        )
    return out


SHARE_DAYS = 30


def create_share(sub: str, report_id: str) -> dict[str, Any]:
    get_report(sub, report_id)  # ownership check
    token = secrets.token_urlsafe(16)
    expires = datetime.now(UTC) + timedelta(days=SHARE_DAYS)
    db.table().put_item(
        Item={
            "PK": f"SHARE#{token}",
            "SK": "META",
            "owner": sub,
            "report_id": report_id,
            "expiresAt": int(expires.timestamp()),
            "created_at": db.now_iso(),
        }
    )
    return {"token": token, "expires_at": expires.isoformat(timespec="seconds")}


def shared_report(token: str) -> dict[str, Any]:
    """Read-only, PII-free view: no bill id, no exact location, no history."""
    meta = db.table().get_item(Key={"PK": f"SHARE#{token}", "SK": "META"}).get("Item")
    if not meta or int(meta["expiresAt"]) < int(datetime.now(UTC).timestamp()):
        raise ApiError(404, "share_not_found", "This link has expired or doesn't exist.")
    item = get_report(str(meta["owner"]), str(meta["report_id"]))
    inputs = dict(item["inputs"])
    roof = dict(inputs.pop("roof"))
    inputs["roof"] = {
        "roof_area_sqft": roof["roof_area_sqft"],
        "shading": roof["shading"],
        "lat": round(roof["lat"], 1),
        "lng": round(roof["lng"], 1),
    }
    return {
        "report": item["report"],
        "working": item["working"],
        "inputs": inputs,
        "created_at": item["created_at"],
        "expires_at": datetime.fromtimestamp(int(meta["expiresAt"]), UTC).isoformat(),
    }
