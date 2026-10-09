"""Bills, solar reports, share links and the ledger."""

from datetime import date
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.auth import CurrentUser
from app.errors import envelope
from app.services import extraction, home, ledger, tips
from app.services import solar_reports as svc

router = APIRouter(tags=["solar"])


class ExtractIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    s3_key: str


@router.post("/bills/extract")
def extract(body: ExtractIn, user: CurrentUser) -> dict[str, Any]:
    """Reads a bill photo into fields with confidence; the user confirms before any maths."""
    return envelope(extraction.extract_bill(user.sub, body.s3_key).model_dump())


@router.post("/bills")
def save_bill(body: svc.BillIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(svc.save_bill(user.sub, body))


@router.post("/solar/reports")
def create_report(body: svc.ReportIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(svc.create_report(user.sub, body))


@router.get("/solar/reports")
def list_reports(user: CurrentUser) -> dict[str, Any]:
    return envelope(svc.list_reports(user.sub))


@router.get("/solar/reports/{report_id}")
def get_report(report_id: str, user: CurrentUser) -> dict[str, Any]:
    return envelope(svc.get_report(user.sub, report_id))


@router.post("/solar/reports/{report_id}/share")
def share_report(report_id: str, user: CurrentUser) -> dict[str, Any]:
    return envelope(svc.create_share(user.sub, report_id))


@router.post("/solar/reports/{report_id}/tips")
def report_tips(report_id: str, user: CurrentUser) -> dict[str, Any]:
    return envelope(tips.tips_for_report(user.sub, report_id).model_dump())


class InstalledIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    installed_on: date


@router.post("/solar/reports/{report_id}/installed")
def mark_installed(report_id: str, body: InstalledIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(home.mark_installed(user.sub, report_id, body.installed_on))


@router.delete("/solar/installed")
def unmark_installed(user: CurrentUser) -> dict[str, Any]:
    home.unmark_installed(user.sub)
    return envelope({"installed": None})


@router.get("/bills")
def list_bills(user: CurrentUser) -> dict[str, Any]:
    return envelope(home.bills(user.sub))


@router.get("/home")
def home_summary(user: CurrentUser) -> dict[str, Any]:
    return envelope(home.summary(user.sub))


@router.get("/ledger")
def get_ledger(user: CurrentUser) -> dict[str, Any]:
    home.refresh_installed(user.sub)
    return envelope(ledger.totals(user.sub))


public = APIRouter(prefix="/public", tags=["public"])


@public.get("/share/{token}")
def shared(token: str) -> dict[str, Any]:
    return envelope(svc.shared_report(token))
