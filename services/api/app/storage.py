"""S3 uploads: private bucket, presigned POSTs that expire in 5 minutes,
keys namespaced uploads/<sub>/..., raw uploads removed by lifecycle after 7 days."""

import uuid
from functools import cache
from typing import Any

import boto3
from botocore.config import Config

from app.config import get_settings
from app.models import UPLOAD_TYPES, PresignedUpload, UploadKind

EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}

USER_PREFIXES = ("uploads", "reports")


@cache
def _s3() -> Any:
    s = get_settings()
    return boto3.client("s3", region_name=s.aws_region, config=Config(signature_version="s3v4"))


def s3() -> Any:
    return _s3()


def reset_clients() -> None:
    _s3.cache_clear()


def user_prefix(kind: str, sub: str) -> str:
    return f"{kind}/{sub}/"


def owns_key(sub: str, key: str) -> bool:
    """A key belongs to the user only if it sits under one of their prefixes."""
    return any(key.startswith(user_prefix(p, sub)) for p in USER_PREFIXES) and ".." not in key


def presign_upload(sub: str, kind: UploadKind, content_type: str) -> PresignedUpload:
    s = get_settings()
    if content_type not in UPLOAD_TYPES[kind]:
        raise ValueError("unsupported content type")
    key = f"{user_prefix('uploads', sub)}{kind}/{uuid.uuid4().hex}.{EXTENSIONS[content_type]}"
    post = s3().generate_presigned_post(
        Bucket=s.uploads_bucket,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, s.max_upload_bytes],
        ],
        ExpiresIn=s.presign_expiry_seconds,
    )
    return PresignedUpload(
        url=post["url"],
        fields=post["fields"],
        key=key,
        expires_in=s.presign_expiry_seconds,
        max_bytes=s.max_upload_bytes,
    )


def delete_user_objects(sub: str) -> int:
    s = get_settings()
    deleted = 0
    paginator = s3().get_paginator("list_objects_v2")
    for prefix in USER_PREFIXES:
        for page in paginator.paginate(Bucket=s.uploads_bucket, Prefix=user_prefix(prefix, sub)):
            objects = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if objects:
                s3().delete_objects(Bucket=s.uploads_bucket, Delete={"Objects": objects})
                deleted += len(objects)
    return deleted
