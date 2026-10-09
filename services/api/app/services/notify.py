"""Email through Amazon SES. A no-op until EMAIL_FROM is set (and verified in SES)."""

import logging

import boto3

from app.config import get_settings

log = logging.getLogger("groundwork.notify")


def send_email(to: str, subject: str, body: str) -> bool:
    s = get_settings()
    if not s.email_from:
        return False
    try:
        boto3.client("ses", region_name=s.aws_region).send_email(
            Source=s.email_from,
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
        )
        return True
    except Exception:
        log.exception("email to a user failed")
        return False
