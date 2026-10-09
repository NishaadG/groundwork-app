from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class Health(BaseModel):
    status: Literal["ok"]


class HealthResponse(BaseModel):
    data: Health
    error: None = None


@router.get("/health")
def health() -> HealthResponse:
    return HealthResponse(data=Health(status="ok"))
