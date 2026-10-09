"""Housing society routes."""

from typing import Any

from fastapi import APIRouter

from app.auth import CurrentUser
from app.errors import envelope
from app.services import society

router = APIRouter(prefix="/society", tags=["society"])


@router.get("")
def read(user: CurrentUser) -> dict[str, Any]:
    if not society.membership(user.sub):
        return envelope(None)
    return envelope(society.dashboard(user.sub))


@router.post("")
def create(body: society.CreateIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.create(user.sub, body))


@router.post("/join")
def join(body: society.JoinIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.join(user.sub, body))


@router.put("/me")
def update_me(body: society.MemberUpdate, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.update_member(user.sub, body))


@router.delete("/me")
def leave(user: CurrentUser) -> dict[str, Any]:
    society.leave(user.sub)
    return envelope({"left": True})


@router.post("/tanks")
def log_tank(body: society.TankIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.log_tank(user.sub, body))


@router.post("/announcements")
def announce(body: society.AnnouncementIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.announce(user.sub, body))


@router.delete("/announcements/{ann_id}")
def delete_announcement(ann_id: str, user: CurrentUser) -> dict[str, Any]:
    society.delete_announcement(user.sub, ann_id)
    return envelope({"deleted": ann_id})


@router.post("/solar")
def common_solar(body: society.CommonSolarIn, user: CurrentUser) -> dict[str, Any]:
    return envelope(society.common_solar(user.sub, body))
