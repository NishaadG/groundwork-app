"""Lambda entry point for the daily reminder job (EventBridge schedule in infra/template.yaml)."""

import logging
from typing import Any

from app.services import reminders

logging.getLogger().setLevel(logging.INFO)


def handler(event: Any, context: Any) -> dict[str, int]:
    result = reminders.send_due()
    logging.info("leak reminders: %s", result)
    return result
