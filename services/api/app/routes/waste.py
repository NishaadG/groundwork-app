"""Waste module routes."""

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict

from app.auth import CurrentUser
from app.calc.waste import data as waste_data
from app.errors import envelope
from app.services import waste

router = APIRouter(prefix="/waste", tags=["waste"])


class PhotoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    s3_key: str


@router.get("/materials")
def materials(user: CurrentUser) -> dict[str, Any]:
    d = waste_data()
    return envelope(
        {
            k: d[k]
            for k in ("materials", "size_presets_kg", "rates_as_of", "rates_source", "co2_source")
        }
    )


@router.post("/scan")
def classify(body: PhotoIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(waste.classify(user.sub, body.s3_key))


@router.post("/scans")
def save_scan(body: waste.ScanIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(waste.save_scan(user.sub, body))


@router.delete("/scans/{scan_id}")
def delete_scan(scan_id: str, user: CurrentUser) -> dict[str, Any]:
    waste.delete_scan(user.sub, scan_id)
    return envelope({"deleted": scan_id})


@router.get("/summary")
def summary(user: CurrentUser) -> dict[str, Any]:
    return envelope(waste.summary(user.sub))


@router.get("/partners")
def partners(user: CurrentUser, city: str | None = None) -> dict[str, Any]:
    return envelope(waste.partners(city))


@router.post("/pickups")
def pickup(body: waste.PickupIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(waste.request_pickup(user.sub, user.email, body))


public = APIRouter(prefix="/public", tags=["public"])


@public.post("/partners")
def partner_signup(body: waste.PartnerIn, request: Request) -> dict[str, Any]:
    """Recyclers apply to be listed; an admin approves (scripts/partners.py)."""
    # Use the last X-Forwarded-For entry: AWS adds the real caller address itself, while
    # anything earlier in the header could have been written by the caller
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
    waste.check_signup_limit(forwarded or (request.client.host if request.client else "unknown"))
    return envelope(waste.partner_signup(body))
