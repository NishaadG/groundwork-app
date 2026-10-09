"""Presigned uploads: the browser sends files straight to S3."""

from typing import Any

from fastapi import APIRouter

from app import storage
from app.auth import CurrentUser
from app.errors import ApiError, envelope
from app.models import UPLOAD_TYPES, PresignRequest

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("/presign")
def presign(body: PresignRequest, user: CurrentUser) -> dict[str, Any]:
    if body.content_type not in UPLOAD_TYPES[body.kind]:
        raise ApiError(
            415,
            "unsupported_file_type",
            f"{body.kind} uploads accept {', '.join(UPLOAD_TYPES[body.kind])}.",
        )
    return envelope(storage.presign_upload(user.sub, body.kind, body.content_type).model_dump())
