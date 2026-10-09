from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.calc.solar import SolarInputs, calc_solar
from app.calc.tariff import BillContext, load_tariff
from app.services import irradiance
from tests.conftest import MintToken

PUNE_SUN = [
    4.9891,
    5.8502,
    6.6137,
    7.0778,
    7.0174,
    4.5682,
    3.3101,
    3.3838,
    4.3092,
    5.0119,
    4.896,
    4.6649,
]
ROOF = {"lat": 18.52, "lng": 73.86, "roof_area_sqft": 350, "shading": "none"}


@pytest.fixture
def nasa_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[float, float]]:
    calls: list[tuple[float, float]] = []

    def fake(lat: float, lng: float) -> list[float]:
        calls.append((lat, lng))
        return PUNE_SUN

    monkeypatch.setattr(irradiance, "fetch_nasa", fake)
    return calls


def h(mint: MintToken, sub: str = "solar-user") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def save_bill(client: TestClient, headers: dict[str, str], **over: Any) -> str:
    bill = {
        "discom": "msedcl",
        "units_kwh": 280,
        "period_start": "2026-08-01",
        "period_end": "2026-08-31",
        "total_amount_inr": 3385,
        "sanctioned_load_kw": 3,
        "supply": "single",
        **over,
    }
    r = client.post("/v1/bills", headers=headers, json=bill)
    assert r.status_code == 200, r.json()
    return str(r.json()["data"]["id"])


def test_bill_to_report_matches_calc(
    client: TestClient, mint_token: MintToken, nasa_calls: list[Any]
) -> None:
    headers = h(mint_token)
    bill_id = save_bill(client, headers)
    r = client.post("/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF})
    assert r.status_code == 200, r.json()
    data = r.json()["data"]
    rep = data["report"]
    # 280 units over 31 days → 274.73 per average month; same result as calling calc directly
    per_month = round(280 * (365 / 12) / 31, 2)
    expected = calc_solar(
        SolarInputs(
            irradiance_kwh_m2_day=PUNE_SUN,
            monthly_units=[per_month] * 12,
            roof_area_sqft=350,
            sanctioned_load_kw=3,
            tariff=load_tariff("msedcl"),
            bill=BillContext(supply="single", load_kw=3),
        )
    )
    assert data["inputs"]["monthly_units"] == [per_month] * 12
    assert rep["size_kw"] == expected.size_kw == 2.0
    assert rep["subsidy_inr"] == 60000
    assert rep["savings_year1_inr"] == expected.savings_year1_inr
    assert [w["id"] for w in data["working"]][0] == "consumption"
    assert data["bill_check"]["matches"] is True
    assert data["inputs"]["tariff"]["id"] == "msedcl"
    assert nasa_calls == [(18.5, 73.9)]

    # Irradiance is cached per 0.1° cell: a second report doesn't call NASA again
    client.post("/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF})
    assert len(nasa_calls) == 1

    listed = client.get("/v1/solar/reports", headers=headers).json()["data"]
    assert len(listed) == 2 and listed[0]["size_kw"] == 2.0

    got = client.get(f"/v1/solar/reports/{data['id']}", headers=headers).json()["data"]
    assert got["report"] == rep


def test_ledger_keeps_only_the_latest_solar_projection(
    client: TestClient, mint_token: MintToken, nasa_calls: list[Any]
) -> None:
    headers = h(mint_token)
    bill_id = save_bill(client, headers)
    first = client.post(
        "/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF}
    )
    second = client.post(
        "/v1/solar/reports",
        headers=headers,
        json={"bill_id": bill_id, "roof": ROOF, "scenario": {"size_kw": 3}},
    )
    led = client.get("/v1/ledger", headers=headers).json()["data"]
    rep2 = second.json()["data"]["report"]
    assert led["entries"] == 3
    assert led["projected"]["inr"] == pytest.approx(rep2["savings_year1_inr"])
    assert led["projected"]["kwh"] == pytest.approx(rep2["annual_generation_kwh"])
    assert led["measured"] == {}
    assert first.json()["data"]["report"]["size_kw"] != rep2["size_kw"]


def test_unlisted_discom_uses_own_bill_rate(
    client: TestClient, mint_token: MintToken, nasa_calls: list[Any]
) -> None:
    headers = h(mint_token)
    r = client.post("/v1/bills", headers=headers, json={"discom": "other", "units_kwh": 200})
    assert r.status_code == 422  # amount needed for the average rate
    bill_id = save_bill(client, headers, discom="other", units_kwh=200, total_amount_inr=1600)
    data = client.post(
        "/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF}
    ).json()["data"]
    t = data["inputs"]["tariff"]
    assert t["id"] == "own-bill-rate" and t["slabs"][0]["energy_inr_per_kwh"] == 8.0
    assert data["bill_check"] is None


def test_bill_validation(client: TestClient, mint_token: MintToken) -> None:
    headers = h(mint_token)
    bad = [
        {"discom": "msedcl", "units_kwh": 0},
        {"discom": "nope", "units_kwh": 100},
        {"discom": "msedcl", "units_kwh": 100, "charges": {"ppac": 10}},  # not an MSEDCL input
        {
            "discom": "msedcl",
            "units_kwh": 100,
            "period_start": "2026-09-01",
            "period_end": "2026-08-01",
        },
    ]
    for body in bad:
        assert client.post("/v1/bills", headers=headers, json=body).status_code == 422, body


def test_reports_are_private(
    client: TestClient, mint_token: MintToken, nasa_calls: list[Any]
) -> None:
    a = h(mint_token, "owner")
    bill_id = save_bill(client, a)
    rid = client.post(
        "/v1/solar/reports", headers=a, json={"bill_id": bill_id, "roof": ROOF}
    ).json()["data"]["id"]
    b = h(mint_token, "intruder")
    assert client.get(f"/v1/solar/reports/{rid}", headers=b).status_code == 404
    assert (
        client.post(
            "/v1/solar/reports", headers=b, json={"bill_id": bill_id, "roof": ROOF}
        ).status_code
        == 404
    )
    assert client.post(f"/v1/solar/reports/{rid}/share", headers=b).status_code == 404


def test_share_link_hides_exact_location(
    client: TestClient, mint_token: MintToken, nasa_calls: list[Any]
) -> None:
    headers = h(mint_token)
    bill_id = save_bill(client, headers)
    rid = client.post(
        "/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF}
    ).json()["data"]["id"]
    share = client.post(f"/v1/solar/reports/{rid}/share", headers=headers).json()["data"]
    pub = client.get(f"/v1/public/share/{share['token']}")
    assert pub.status_code == 200
    body = pub.json()["data"]
    assert body["inputs"]["roof"]["lat"] == 18.5
    assert "bill_id" not in body and "id" not in body
    assert client.get("/v1/public/share/not-a-token").status_code == 404


def test_irradiance_outage_is_a_clear_error(
    client: TestClient, mint_token: MintToken, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(lat: float, lng: float) -> list[float]:
        raise TimeoutError("nasa down")

    monkeypatch.setattr(irradiance, "fetch_nasa", boom)
    headers = h(mint_token)
    bill_id = save_bill(client, headers)
    r = client.post("/v1/solar/reports", headers=headers, json={"bill_id": bill_id, "roof": ROOF})
    assert r.status_code == 503 and r.json()["error"]["code"] == "irradiance_unavailable"
