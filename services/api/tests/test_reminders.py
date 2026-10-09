from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import reminders_handler
from app.services import notify, reminders
from tests.conftest import MintToken


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    sent: list[dict[str, str]] = []

    def fake_send(to: str, subject: str, body: str) -> bool:
        sent.append({"to": to, "subject": subject, "body": body})
        return True

    monkeypatch.setattr(notify, "send_email", fake_send)
    return sent


def test_only_opted_in_households_get_a_reminder(
    client: TestClient, mint_token: MintToken, outbox: list[dict[str, str]]
) -> None:
    on = auth(mint_token("asha"))
    off = auth(mint_token("ravi"))
    r = client.put("/v1/me", headers=on, json={"name": "Asha", "leak_reminders": True})
    assert r.status_code == 200 and r.json()["data"]["leak_reminders"] is True
    client.put("/v1/me", headers=off, json={"name": "Ravi"})

    assert reminders.send_due() == {"sent": 1, "skipped": 0}
    assert [m["to"] for m in outbox] == ["asha@example.com"]
    assert outbox[0]["body"].startswith("Hello Asha,")
    assert "/app/water" in outbox[0]["body"]


def test_reminders_wait_a_month_and_skip_households_that_logged_a_reading(
    client: TestClient, mint_token: MintToken, outbox: list[dict[str, str]]
) -> None:
    h = auth(mint_token("asha"))
    client.put("/v1/me", headers=h, json={"leak_reminders": True})
    now = datetime.now(UTC)

    assert reminders.send_due(now)["sent"] == 1
    # Tomorrow: already reminded this month
    assert reminders.send_due(now + timedelta(days=1)) == {"sent": 0, "skipped": 1}
    # A month on, they're due again
    assert reminders.send_due(now + timedelta(days=31))["sent"] == 1

    # A household that logged a reading this month is already checking; no nudge needed
    ravi = auth(mint_token("ravi"))
    client.put("/v1/me", headers=ravi, json={"leak_reminders": True})
    r = client.post("/v1/water/readings", headers=ravi, json={"kind": "meter", "value": 1234})
    assert r.status_code == 200
    assert reminders.send_due(now + timedelta(days=1)) == {"sent": 0, "skipped": 2}
    assert len(outbox) == 2


def test_turning_reminders_off_removes_the_household(
    client: TestClient, mint_token: MintToken, outbox: list[dict[str, str]]
) -> None:
    h = auth(mint_token("asha"))
    client.put("/v1/me", headers=h, json={"leak_reminders": True})
    r = client.put("/v1/me", headers=h, json={"leak_reminders": False})
    assert r.json()["data"]["leak_reminders"] is False
    assert reminders.send_due() == {"sent": 0, "skipped": 0}
    assert outbox == []


def test_a_failed_email_is_retried_next_run(
    client: TestClient, mint_token: MintToken, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.put("/v1/me", headers=auth(mint_token("asha")), json={"leak_reminders": True})
    monkeypatch.setattr(notify, "send_email", lambda *a: False)
    assert reminders.send_due() == {"sent": 0, "skipped": 1}
    monkeypatch.setattr(notify, "send_email", lambda *a: True)
    assert reminders.send_due()["sent"] == 1


def test_handler_runs_the_job(
    client: TestClient, mint_token: MintToken, outbox: list[dict[str, str]]
) -> None:
    client.put("/v1/me", headers=auth(mint_token("asha")), json={"leak_reminders": True})
    result: Any = reminders_handler.handler({}, None)
    assert result == {"sent": 1, "skipped": 0}


def test_no_sender_configured_means_no_email(aws: dict[str, Any]) -> None:
    assert notify.send_email("a@example.com", "s", "b") is False
