"""Profile, export and account deletion."""

from typing import Any

import boto3
from fastapi import APIRouter

from app import db, storage
from app.auth import CurrentUser
from app.config import get_settings
from app.errors import ApiError, envelope
from app.models import Profile, ProfileFields
from app.services import reminders, society, water

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
def read_me(user: CurrentUser) -> dict[str, Any]:
    profile = db.get_profile(user.sub)
    if profile is None:
        # First visit after sign-up: nothing stored yet, onboarding starts at step 0.
        return envelope({"email": user.email, "onboarding_step": 0, "onboarding_done": False})
    return envelope(Profile.model_validate(profile).model_dump())


@router.put("")
def update_me(body: ProfileFields, user: CurrentUser) -> dict[str, Any]:
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise ApiError(422, "nothing_to_update", "Send at least one field to update.")
    profile = db.upsert_profile(user.sub, fields, user.email)
    if "leak_reminders" in fields:
        reminders.set_subscription(user.sub, bool(fields["leak_reminders"]))
    return envelope(Profile.model_validate(profile).model_dump())


@router.get("/export")
def export_me(user: CurrentUser) -> dict[str, Any]:
    items = [db.from_dynamo(i) for i in db.user_items(user.sub)]
    for item in items:
        item.pop("PK", None)
    return envelope({"exported_at": db.now_iso(), "items": items})


@router.delete("")
def delete_me(user: CurrentUser) -> dict[str, Any]:
    """Removes every record, every file and the Cognito user."""
    water.delete_devices(user.sub)  # device-key lookups live outside the user's partition
    society.leave(user.sub)  # so does the society membership
    items = db.delete_user_items(user.sub)
    files = storage.delete_user_objects(user.sub)
    s = get_settings()
    cognito = boto3.client("cognito-idp", region_name=s.cognito_region)
    try:
        cognito.admin_delete_user(UserPoolId=s.cognito_user_pool_id, Username=user.username)
    except cognito.exceptions.UserNotFoundException:
        pass
    return envelope({"deleted_items": items, "deleted_files": files})
