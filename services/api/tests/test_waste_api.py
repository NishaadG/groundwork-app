import io
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import db
from app.services import extraction
from tests.conftest import MintToken


class FakeBedrock:
    def __init__(self, out: dict[str, Any]) -> None:
        self.out = out

    def converse(self, **kwargs: Any) -> dict[str, Any]:
        enum = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["properties"][
            "items"
        ]["items"]["properties"]["material"]["enum"]
        assert "pet" in enum and "multilayer" in enum
        return {"output": {"message": {"content": [{"toolUse": {"input": self.out}}]}}}


def auth(mint: MintToken, sub: str = "binny") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def put_photo(aws: dict[str, Any], key: str) -> None:
    buf = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buf, format="JPEG")
    aws["s3"].put_object(
        Bucket="groundwork-uploads-test", Key=key, Body=buf.getvalue(), ContentType="image/jpeg"
    )


def test_classify_maps_to_known_materials_and_drops_numeric_tips(
    client: TestClient, mint_token: MintToken, aws: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    put_photo(aws, "uploads/binny/waste/a.jpg")
    monkeypatch.setattr(
        extraction,
        "bedrock",
        lambda: FakeBedrock(
            {
                "items": [
                    {
                        "label": "Water bottles",
                        "material": "pet",
                        "tip": "Rinse and crush them.",
                        "confidence": "high",
                    },
                    {
                        "label": "Chips packet",
                        "material": "multilayer",
                        "tip": "Worth ₹5 a kg",
                        "confidence": "medium",
                    },
                    {"label": "Mystery", "material": "plutonium", "confidence": "high"},
                ]
            }
        ),
    )
    r = client.post(
        "/v1/waste/scan", headers=auth(mint_token), json={"s3_key": "uploads/binny/waste/a.jpg"}
    )
    items = r.json()["data"]["items"]
    assert [i["material"] for i in items] == ["pet", "multilayer", "other"]
    assert items[0]["tip"] == "Rinse and crush them."
    # the model's tip had a number in it, so our own sourced note replaces it
    from app.calc.waste import materials

    assert items[1]["tip"] == materials()["multilayer"]["note"]
    assert items[0]["stream"] == "dry" and items[0]["recyclable"] is True


def test_save_scan_posts_kg_and_co2_to_ledger(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token)
    r = client.post(
        "/v1/waste/scans",
        headers=h,
        json={
            "items": [
                {"material": "newspaper", "kg": 5},
                {"material": "pet", "size": "bag"},
                {"material": "sanitary", "kg": 1},
            ]
        },
    )
    assert r.status_code == 200, r.json()
    scan = r.json()["data"]
    assert scan["kg_total"] == 7.5 and scan["kg_diverted"] == 6.5  # sanitary isn't diverted
    assert (scan["inr_min"], scan["inr_max"]) == (85, 90)  # 5×11–12 + 1.5×20
    led = client.get("/v1/ledger", headers=h).json()["data"]
    assert led["estimated"]["kg"] == 6.5  # a size preset was used, so kg is an estimate
    assert led["estimated"]["co2_t"] == pytest.approx(scan["co2_t"])
    assert (
        "inr" not in led["estimated"] and "inr" not in led["measured"]
    )  # scrap value isn't money in hand

    summary = client.get("/v1/waste/summary", headers=h).json()["data"]
    assert summary["week"]["kg_by_stream"] == {"dry": 6.5, "sanitary": 1.0}
    assert summary["week"]["kg_diverted"] == 6.5 and summary["week"]["tip"] is None

    # Correcting a scan removes its ledger entries
    client.delete(f"/v1/waste/scans/{scan['id']}", headers=h)
    assert client.get("/v1/ledger", headers=h).json()["data"]["entries"] == 0


def test_scan_validation(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token)
    assert (
        client.post("/v1/waste/scans", headers=h, json={"items": [{"material": "pet"}]}).json()[
            "error"
        ]["code"]
        == "weight_needed"
    )
    assert (
        client.post(
            "/v1/waste/scans", headers=h, json={"items": [{"material": "gold", "kg": 1}]}
        ).json()["error"]["code"]
        == "unknown_material"
    )


def test_partner_signup_needs_approval_and_pickup_flow(
    client: TestClient, mint_token: MintToken
) -> None:
    applied = client.post(
        "/v1/public/partners",
        json={
            "name": "Shree Scrap",
            "area": "Aundh",
            "city": "Pune",
            "materials": ["newspaper", "pet"],
            "phone": "+91 98765 43210",
        },
    ).json()["data"]
    h = auth(mint_token)
    assert client.get("/v1/waste/partners", headers=h).json()["data"] == []  # pending isn't listed
    db.table().update_item(
        Key={"PK": f"PARTNER#{applied['id']}", "SK": "META"},
        UpdateExpression="SET #s = :a, GSI1SK = :k",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":a": "approved", ":k": f"approved#{applied['id']}"},
    )
    listed = client.get("/v1/waste/partners?city=pune", headers=h).json()["data"]
    assert [p["name"] for p in listed] == ["Shree Scrap"] and listed[0]["is_demo"] is False

    scan = client.post(
        "/v1/waste/scans", headers=h, json={"items": [{"material": "newspaper", "kg": 4}]}
    ).json()["data"]
    r = client.post(
        "/v1/waste/pickups",
        headers=h,
        json={"partner_id": applied["id"], "scan_id": scan["id"], "preferred_date": "2026-10-05"},
    ).json()["data"]
    assert r["status"] == "requested" and r["emailed"] is False  # no SES sender configured
    assert r["partner"]["phone"] == "+91 98765 43210"
    assert "Newspaper (4 kg)" in r["items"]

    # Someone else can't request a pickup for this scan
    other = client.post(
        "/v1/waste/pickups",
        headers=auth(mint_token, "other"),
        json={"partner_id": applied["id"], "scan_id": scan["id"], "preferred_date": "2026-10-05"},
    )
    assert other.status_code == 404


def test_partner_signup_validation(client: TestClient) -> None:
    bad = client.post(
        "/v1/public/partners",
        json={"name": "X", "area": "A", "city": "Pune", "materials": [], "phone": "abc"},
    )
    assert bad.status_code == 422


def test_home_ledger_explains_waste_entries(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token)
    client.post("/v1/waste/scans", headers=h, json={"items": [{"material": "newspaper", "kg": 5}]})
    steps = {w["id"]: w for w in client.get("/v1/home", headers=h).json()["data"]["ledger_working"]}
    assert steps["ledger_kg"]["inputs"]["waste_scan_measured"] == 5
    assert "waste_scan:" in steps["ledger_kg"]["formula"]
    assert "solar" not in steps["ledger_co2_t"]["formula"]
    assert "installed_on" not in steps["ledger_co2_t"]["inputs"]


def test_partner_signup_is_rate_limited_per_address(client: TestClient) -> None:
    body = {
        "name": "Shree Scrap",
        "area": "Aundh",
        "city": "Pune",
        "materials": ["pet"],
        "phone": "9876543210",
    }
    h = {"X-Forwarded-For": "1.2.3.4, 203.0.113.7"}  # the first entry is spoofable
    codes = [client.post("/v1/public/partners", headers=h, json=body).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]
    # A spoofed first entry doesn't reset the limit
    spoof = {"X-Forwarded-For": "9.9.9.9, 203.0.113.7"}
    assert client.post("/v1/public/partners", headers=spoof, json=body).status_code == 429
    # Another address is unaffected, and the raw address is never stored
    assert (
        client.post(
            "/v1/public/partners", headers={"X-Forwarded-For": "198.51.100.1"}, json=body
        ).status_code
        == 200
    )
    items = db.table().scan()["Items"]
    assert not any("203.0.113.7" in str(i) for i in items)


def test_classify_when_bedrock_is_not_enabled(
    client: TestClient, mint_token: MintToken, aws: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    put_photo(aws, "uploads/binny/waste/b.jpg")

    class Refusing:
        def converse(self, **_: Any) -> dict[str, Any]:
            raise RuntimeError("An error occurred (ValidationException): Operation not allowed")

    monkeypatch.setattr(extraction, "bedrock", lambda: Refusing())
    r = client.post(
        "/v1/waste/scan", headers=auth(mint_token), json={"s3_key": "uploads/binny/waste/b.jpg"}
    )
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"
