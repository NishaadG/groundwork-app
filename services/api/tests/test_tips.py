from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import extraction, irradiance, tips
from tests.conftest import MintToken
from tests.test_solar_api import PUNE_SUN, ROOF, save_bill


class FakeBedrock:
    def __init__(self, out: dict[str, Any]) -> None:
        self.out = out
        self.calls = 0

    def converse(self, **kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        assert kwargs["toolConfig"]["toolChoice"] == {"tool": {"name": "record_tips"}}
        return {"output": {"message": {"content": [{"toolUse": {"input": self.out}}]}}}


GOOD = {
    "tips": [
        {
            "title": "Run the geyser for a shorter time",
            "body": "A timer stops it heating all morning. Most of your bill sits in your top slab.",
        },
        {
            "title": "Set the AC a little warmer",
            "body": "Each degree warmer cuts what it draws. Your top slab is where this saves most.",
        },
        {
            "title": "Cut the AC to 18 degrees off",
            "body": "This one has a number and must be dropped.",
        },
        {
            "title": "Switch off standby power",
            "body": "TVs and set-top boxes draw power all day. A switched socket ends that.",
        },
    ]
}


def make_report(
    client: TestClient, mint: MintToken, monkeypatch: pytest.MonkeyPatch
) -> tuple[dict[str, str], str]:
    monkeypatch.setattr(irradiance, "fetch_nasa", lambda lat, lng: PUNE_SUN)
    headers = {"Authorization": f"Bearer {mint('tipper')}"}
    bill_id = save_bill(client, headers)
    rid = client.post(
        "/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF}
    ).json()["data"]["id"]
    return headers, rid


def test_tips_drop_numbers_and_are_cached(
    client: TestClient, mint_token: MintToken, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = FakeBedrock(GOOD)
    monkeypatch.setattr(extraction, "bedrock", lambda: fake)
    headers, rid = make_report(client, mint_token, monkeypatch)
    r = client.post(f"/v1/solar/reports/{rid}/tips", headers=headers)
    assert r.status_code == 200, r.json()
    data = r.json()["data"]
    titles = [t["title"] for t in data["tips"]]
    assert len(titles) == 3 and "Cut the AC to 18 degrees off" not in titles
    # 274.73 units/month → 101–300 slab: (10.80 + 1.60) × 1.16
    assert data["rupees_per_unit_cut"] == pytest.approx(12.4 * 1.16, abs=0.01)
    assert data["top_slab"] == "101 to 300 units"
    again = client.post(f"/v1/solar/reports/{rid}/tips", headers=headers).json()["data"]
    assert again["tips"] == data["tips"] and fake.calls == 1
    stored = client.get(f"/v1/solar/reports/{rid}", headers=headers).json()["data"]
    assert stored["tips"]["tips"] == data["tips"]


def test_all_tips_with_numbers_means_no_tips(
    client: TestClient, mint_token: MintToken, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        extraction,
        "bedrock",
        lambda: FakeBedrock(
            {"tips": [{"title": "Save ₹500 a month", "body": "Do it for 3 months and see."}]}
        ),
    )
    headers, rid = make_report(client, mint_token, monkeypatch)
    r = client.post(f"/v1/solar/reports/{rid}/tips", headers=headers)
    assert r.status_code == 502 and r.json()["error"]["code"] == "tips_unavailable"


def test_devanagari_digits_count_as_numbers() -> None:
    assert (
        tips.clean(
            {
                "tips": [
                    {"title": "Use ५ fewer units", "body": "Turn things off when you leave a room."}
                ]
            }
        )
        == []
    )
