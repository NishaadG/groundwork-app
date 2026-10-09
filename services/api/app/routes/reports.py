"""Reports: solar reports, report-card history and the impact report."""

from typing import Any

from fastapi import APIRouter

from app.auth import CurrentUser
from app.errors import envelope
from app.services import reports

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("")
def overview(user: CurrentUser) -> dict[str, Any]:
    return envelope(reports.overview(user.sub, user.email))
