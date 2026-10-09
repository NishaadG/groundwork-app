"""Copilot chat (Server-Sent Events)."""

from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app import db
from app.auth import CurrentUser
from app.errors import envelope
from app.services import chat

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
def send(body: chat.ChatIn, user: CurrentUser) -> StreamingResponse:
    session_id, session = chat.prepare(user.sub, body)
    lang = str((db.get_profile(user.sub) or {}).get("lang") or "en")
    return StreamingResponse(
        chat.stream(user.sub, lang, body, session_id, session),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{session_id}")
def history(session_id: str, user: CurrentUser) -> dict[str, Any]:
    if not session_id.isalnum() or len(session_id) > 32:
        return envelope({"turns": []})
    return envelope({"turns": chat.load_history(user.sub, session_id)})
