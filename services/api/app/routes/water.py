"""Water module routes."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Header
from pydantic import BaseModel, ConfigDict, Field

from app.auth import CurrentUser
from app.errors import envelope
from app.services import water

router = APIRouter(prefix="/water", tags=["water"])


@router.get("/summary")
def summary(user: CurrentUser) -> dict[str, Any]:
    return envelope(water.summary(user.sub))


@router.post("/readings")
def add_reading(body: water.ReadingIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.add_reading(user.sub, body))


class PhotoIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    s3_key: str


@router.post("/meter-photo")
def meter_photo(body: PhotoIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.read_meter_photo(user.sub, body.s3_key))


@router.post("/leak-check")
def start_check(body: water.ReadingIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.start_check(user.sub, body))


class FinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: float = Field(ge=0, le=100_000_000)
    at: datetime | None = None


@router.post("/leak-check/{check_id}/finish")
def finish_check(check_id: str, body: FinishIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.finish_check(user.sub, check_id, body.value, body.at))


@router.post("/events/{event_id}/fixed")
def fixed(event_id: str, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.mark_fixed(user.sub, event_id))


class DeviceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=60)


@router.post("/devices")
def create_device(body: DeviceIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(water.create_device(user.sub, body.name))


@router.delete("/devices/{device_id}")
def delete_device(device_id: str, user: CurrentUser) -> dict[str, Any]:
    return envelope({"deleted": water.delete_devices(user.sub, device_id)})


iot = APIRouter(prefix="/iot", tags=["iot"])


@iot.post("/ingest")
def ingest(body: water.IngestIn, x_device_key: str | None = Header(default=None)) -> dict[str, Any]:
    """Smart-meter / IoT readings, authenticated by a device key (not a user token)."""
    return envelope(water.ingest(x_device_key, body))
