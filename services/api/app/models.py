"""Pydantic schemas for the API. Field names are snake_case end to end."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.calc.tariff import available_tariffs

Lang = Literal["en", "hi", "mr"]
HomeType = Literal["flat", "independent_house", "bungalow"]
WaterSource = Literal["municipal", "borewell", "tanker", "mixed"]
Shading = Literal["none", "partial", "heavy"]
Supply = Literal["single", "three"]


class ProfileFields(BaseModel):
    """Everything a user can set about themselves and their home. All optional so
    onboarding can save one step at a time."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    lang: Lang | None = None
    home_type: HomeType | None = None
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=60)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    roof_area_sqft: float | None = Field(default=None, gt=0, le=200_000)
    shading: Shading | None = None
    household_size: int | None = Field(default=None, ge=1, le=40)
    discom: str | None = None
    supply: Supply | None = None
    sanctioned_load_kw: float | None = Field(default=None, gt=0, le=200)
    approx_monthly_bill_inr: float | None = Field(default=None, ge=0, le=1_000_000)
    water_source: WaterSource | None = None
    tank_litres: float | None = Field(default=None, ge=0, le=1_000_000)
    water_inr_per_kl: float | None = Field(default=None, ge=0, le=10_000)
    tanker_litres: float | None = Field(default=None, gt=0, le=50_000)
    inr_per_tanker: float | None = Field(default=None, ge=0, le=100_000)
    onboarding_step: int | None = Field(default=None, ge=0, le=4)
    onboarding_done: bool | None = None
    leak_reminders: bool | None = None

    @field_validator("discom")
    @classmethod
    def _known_discom(cls, v: str | None) -> str | None:
        if v is not None and v != "other" and v not in available_tariffs():
            raise ValueError("unknown DISCOM")
        return v


class Profile(ProfileFields):
    model_config = ConfigDict(extra="ignore")

    email: str | None = None
    created_at: str
    updated_at: str


UploadKind = Literal["bill", "meter", "waste"]

UPLOAD_TYPES: dict[UploadKind, tuple[str, ...]] = {
    "bill": ("image/jpeg", "image/png", "image/webp", "application/pdf"),
    "meter": ("image/jpeg", "image/png", "image/webp"),
    "waste": ("image/jpeg", "image/png", "image/webp"),
}


class PresignRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: UploadKind
    content_type: str


class PresignedUpload(BaseModel):
    url: str
    fields: dict[str, str]
    key: str
    expires_in: int
    max_bytes: int
