from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import extraction, water
from tests.conftest import MintToken


def auth(mint: MintToken, sub: str = "aqua") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def iso(dt: datetime) -> str:
    return dt.isoformat()


NOW = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)


def test_tank_readings_need_tank_size(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token)
    r = client.post("/v1/water/readings", headers=h, json={"kind": "tank", "value": 60})
    assert r.status_code == 422 and r.json()["error"]["code"] == "tank_size_needed"
    client.put("/v1/me", headers=h, json={"tank_litres": 1000})
    assert (
        client.post("/v1/water/readings", headers=h, json={"kind": "tank", "value": 60}).status_code
        == 200
    )
    assert (
        client.post(
            "/v1/water/readings", headers=h, json={"kind": "tank", "value": 160}
        ).status_code
        == 422
    )


def test_future_readings_rejected(client: TestClient, mint_token: MintToken) -> None:
    r = client.post(
        "/v1/water/readings",
        headers=auth(mint_token),
        json={"kind": "meter", "value": 10, "at": iso(NOW + timedelta(days=1))},
    )
    assert r.json()["error"]["code"] == "future_reading"


def test_manual_leak_check_flags_injected_leak_then_fix_counts_only_after_drop(
    client: TestClient, mint_token: MintToken
) -> None:
    """Phase 5 DoD: a manual night/morning check flags an injected leak; litres saved are
    counted only after a confirmed fix and an actual drop."""
    h = auth(mint_token)
    client.put("/v1/me", headers=h, json={"household_size": 4})
    # 20 days of meter history at ~600 L/day, with a leak adding ~150 L/day
    start = NOW - timedelta(days=24)
    litres = 100_000.0
    for d in range(21):
        client.post(
            "/v1/water/readings",
            headers=h,
            json={"kind": "meter", "value": litres, "at": iso(start + timedelta(days=d))},
        )
        litres += 750
    night_at = start + timedelta(days=20, hours=23)
    check = client.post(
        "/v1/water/leak-check",
        headers=h,
        json={"kind": "meter", "value": litres, "at": iso(night_at)},
    ).json()["data"]
    # injected leak: 50 L moved in 8 hours with nobody using water → 150 L/day
    res = client.post(
        f"/v1/water/leak-check/{check['id']}/finish",
        headers=h,
        json={"value": litres + 50, "at": iso(night_at + timedelta(hours=8))},
    ).json()["data"]
    assert res["leak"] is True and res["result"]["litres_per_day"] == 150
    assert res["result"]["working"]["id"] == "leak_check"

    summary = client.get("/v1/water/summary", headers=h).json()["data"]
    event = summary["events"][0]
    assert event["status"] == "open" and event["litres_per_day"] == 150
    assert summary["lpcd"]["benchmark"] == 135

    # Mark fixed; no "after" readings yet → nothing counted
    client.post(f"/v1/water/events/{event['id']}/fixed", headers=h)
    led = client.get("/v1/ledger", headers=h).json()["data"]
    assert led["measured"].get("litres") is None


def test_fix_without_a_drop_is_not_counted(client: TestClient, mint_token: MintToken) -> None:
    from app.services import water

    h = auth(mint_token, "nodrop")
    detected = NOW - timedelta(days=6)
    event = {
        "id": "e1",
        "litres_per_day": 150,
        "detected_at": iso(detected),
        "fixed_at": iso(NOW - timedelta(days=5)),
    }
    from app.calc.water import DailyUse

    series = [
        DailyUse(day=(NOW - timedelta(days=20 - i)).date().isoformat(), litres=700)
        for i in range(20)
    ]
    saved = water._savings("nodrop", event, series)
    assert saved is not None and saved["counted"] is False
    assert client.get("/v1/ledger", headers=h).json()["data"]["measured"] == {}


def test_fix_with_a_drop_posts_measured_litres(client: TestClient, mint_token: MintToken) -> None:
    from app.calc.water import DailyUse
    from app.services import water

    h = auth(mint_token, "drop")
    client.put("/v1/me", headers=h, json={"water_inr_per_kl": 40})
    detected = NOW - timedelta(days=8)
    fixed = NOW - timedelta(days=5)
    event = {
        "id": "e2",
        "litres_per_day": 150,
        "detected_at": iso(detected),
        "fixed_at": iso(fixed),
    }
    series = [
        DailyUse(
            day=(NOW - timedelta(days=25 - i)).date().isoformat(), litres=750 if i < 21 else 600
        )
        for i in range(25)
    ]
    saved = water._savings("drop", event, series)
    assert saved is not None and saved["counted"] is True
    led = client.get("/v1/ledger", headers=h).json()["data"]
    assert led["measured"]["litres"] == pytest.approx(saved["litres"])
    assert led["measured"]["inr"] == pytest.approx(saved["litres"] / 1000 * 40)
    # Re-reading the summary doesn't double-count
    water._savings("drop", event, series)
    assert client.get("/v1/ledger", headers=h).json()["data"]["measured"][
        "litres"
    ] == pytest.approx(saved["litres"])


def test_iot_ingest_with_device_key(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token, "iot")
    dev = client.post("/v1/water/devices", headers=h, json={"name": "Simulated meter"}).json()[
        "data"
    ]
    assert dev["key"].startswith("gwd_")
    pts = [{"at": iso(NOW - timedelta(hours=10 - i)), "value": 2000 + i * 30} for i in range(10)]
    assert client.post("/v1/iot/ingest", json={"readings": pts}).status_code == 401
    assert (
        client.post(
            "/v1/iot/ingest", headers={"X-Device-Key": "gwd_wrong"}, json={"readings": pts}
        ).status_code
        == 401
    )
    r = client.post("/v1/iot/ingest", headers={"X-Device-Key": dev["key"]}, json={"readings": pts})
    assert r.json()["data"] == {"accepted": 10}
    summary = client.get("/v1/water/summary", headers=h).json()["data"]
    assert summary["stream"]["count"] == 10 and summary["latest"][0]["source"] == "iot"

    # Deleting the account removes the key, so the device can no longer post
    client.delete("/v1/me", headers=h)
    assert (
        client.post(
            "/v1/iot/ingest", headers={"X-Device-Key": dev["key"]}, json={"readings": pts}
        ).status_code
        == 401
    )


class FakeBedrock:
    def __init__(self, out: dict[str, Any]) -> None:
        self.out = out

    def converse(self, **kwargs: Any) -> dict[str, Any]:
        return {"output": {"message": {"content": [{"toolUse": {"input": self.out}}]}}}


def test_meter_photo_converts_units(
    client: TestClient, mint_token: MintToken, aws: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, format="JPEG")
    aws["s3"].put_object(
        Bucket="groundwork-uploads-test",
        Key="uploads/meterman/meter/a.jpg",
        Body=buf.getvalue(),
        ContentType="image/jpeg",
    )
    h = auth(mint_token, "meterman")
    monkeypatch.setattr(
        extraction,
        "bedrock",
        lambda: FakeBedrock(
            {
                "whole_digits": "00482",
                "fraction_digits": "137",
                "unit": "cubic_metres",
                "confidence": "high",
                "evidence": "00482 137",
            }
        ),
    )
    r = client.post(
        "/v1/water/meter-photo", headers=h, json={"s3_key": "uploads/meterman/meter/a.jpg"}
    ).json()["data"]
    assert r["litres"] == 482137.0 and r["confidence"] == "high"
    monkeypatch.setattr(
        extraction,
        "bedrock",
        lambda: FakeBedrock(
            {"whole_digits": "12", "fraction_digits": "", "unit": "unknown", "confidence": "high"}
        ),
    )
    r = client.post(
        "/v1/water/meter-photo", headers=h, json={"s3_key": "uploads/meterman/meter/a.jpg"}
    ).json()["data"]
    assert r["litres"] is None and r["confidence"] == "low"
    # Can't read someone else's photo
    other = client.post(
        "/v1/water/meter-photo",
        headers=auth(mint_token, "x"),
        json={"s3_key": "uploads/meterman/meter/a.jpg"},
    )
    assert other.status_code == 404


class Scripted:
    """Returns one scripted reading per call (first read, then the enhanced-copy read)."""

    def __init__(self, *reads: dict[str, Any]) -> None:
        self.reads = list(reads)

    def converse(self, **kwargs: Any) -> dict[str, Any]:
        return {"output": {"message": {"content": [{"toolUse": {"input": self.reads.pop(0)}}]}}}


def read(
    whole: str, frac: str = "", conf: str = "high", unit: str = "cubic_metres"
) -> dict[str, Any]:
    return {"whole_digits": whole, "fraction_digits": frac, "unit": unit, "confidence": conf}


def meter_image() -> dict[str, Any]:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (60, 60), "white").save(buf, format="JPEG")
    return {"image": {"format": "jpeg", "source": {"bytes": buf.getvalue()}}}


@pytest.mark.parametrize(
    ("first", "second", "litres", "confidence"),
    [
        (read("00325", "663"), read("00325", "663"), 325663.0, "high"),
        # Fraction wheels differ: keep only the whole unit and say so
        (read("00325", "663"), read("00325", "683"), 325000.0, "medium"),
        # Whole digits differ: the reading is flagged for the user to check
        (read("00325", "663"), read("00345", "663"), 325663.0, "low"),
        # Different units on the two reads can't be trusted either
        (read("00325", "663"), read("00325", "663", unit="litres"), 325663.0, "medium"),
    ],
)
def test_two_reads_must_agree_for_high_confidence(
    monkeypatch: pytest.MonkeyPatch,
    first: dict[str, Any],
    second: dict[str, Any],
    litres: float,
    confidence: str,
) -> None:
    model = Scripted(first, second)
    monkeypatch.setattr(extraction, "bedrock", lambda: model)
    out = water.read_meter_image(meter_image())
    assert out["litres"] == litres and out["confidence"] == confidence


def test_no_whole_digits_means_no_reading(monkeypatch: pytest.MonkeyPatch) -> None:
    model = Scripted(read(""), read(""))
    monkeypatch.setattr(extraction, "bedrock", lambda: model)
    out = water.read_meter_image(meter_image())
    assert out["litres"] is None and out["confidence"] == "low"
