from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.calc.solar import SolarInputs, calc_solar, society_subsidy
from app.calc.tariff import BillContext, available_tariffs, load_tariff
from app.services import irradiance
from tests.conftest import MintToken
from tests.test_society_api import auth, make_society
from tests.test_solar_api import PUNE_SUN

COMMON = {
    "discom": "msedcl",
    "supply": "three",
    "sanctioned_load_kw": 20,
    "monthly_units": 1500,
    "terrace_area_sqft": 3000,
}


@pytest.fixture(autouse=True)
def _sun(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(irradiance, "fetch_nasa", lambda lat, lng: PUNE_SUN)


def located(client: TestClient, mint: MintToken, sub: str) -> dict[str, str]:
    h = auth(mint, sub)
    client.put("/v1/me", headers=h, json={"lat": 18.52, "lng": 73.86})
    return h


def test_society_subsidy_caps() -> None:
    # ₹18,000/kW, at most 3 kW per home and 500 kW in all, less what residents claimed
    assert society_subsidy(20, homes=40) == (20, 360_000)
    assert society_subsidy(150, homes=40) == (120, 2_160_000)
    assert society_subsidy(20, homes=40, kw_already=110) == (10, 180_000)
    assert society_subsidy(20, homes=40, kw_already=130) == (0, 0)
    assert society_subsidy(600, homes=400) == (500, 9_000_000)


def test_every_tariff_says_where_common_areas_are_billed() -> None:
    for tid in available_tariffs():
        ca = load_tariff(tid).common_area
        assert ca and "page" in ca.source and ca.source_url.startswith("https://"), tid


def test_admin_estimate_matches_the_calculator_and_members_see_it(
    client: TestClient, mint_token: MintToken
) -> None:
    s = make_society(client, mint_token)
    admin = located(client, mint_token, "anika")
    r = client.post("/v1/society/solar", headers=admin, json=COMMON)
    assert r.status_code == 200, r.json()
    common = r.json()["data"]["common_solar"]
    res = common["result"]

    tariff = load_tariff("msedcl")
    direct = calc_solar(
        SolarInputs(
            irradiance_kwh_m2_day=PUNE_SUN,
            monthly_units=[1500] * 12,
            roof_area_sqft=3000,
            sanctioned_load_kw=20,
            tariff=tariff,
            bill=BillContext(supply="three", load_kw=20),
            society_homes=40,
        )
    )
    assert res["size_kw"] == direct.size_kw and res["size_kw"] > 3
    assert res["subsidy_inr"] == direct.subsidy_inr == res["size_kw"] * 18_000
    assert res["savings_year1_inr"] == direct.savings_year1_inr > 0
    assert res["per_home"]["net_cost_inr"] == round(direct.net_cost_inr / 40)
    ids = [w["id"] for w in common["working"]]
    assert ids[:2] == ["common_units", "common_tariff"] and "subsidy_society" in ids
    assert "subsidy" not in ids
    tariff_step = common["working"][1]
    assert "Case No. 217 of 2024" in tariff_step["source"]["name"]

    code = s["invite_code"]
    member = auth(mint_token, "ravi")
    client.post("/v1/society/join", headers=member, json={"code": code})
    seen = client.get("/v1/society", headers=member).json()["data"]["common_solar"]
    assert seen["result"] == res and seen["inputs"]["monthly_units"] == 1500
    # Members can see it but not change it
    r = client.post("/v1/society/solar", headers=member, json=COMMON)
    assert r.status_code == 403


def test_residents_own_subsidised_plants_reduce_the_society_subsidy(
    client: TestClient, mint_token: MintToken
) -> None:
    make_society(client, mint_token, flats=4)  # cap 12 kW
    admin = located(client, mint_token, "anika")
    body = {**COMMON, "kw_already_subsidised": 9, "cost_inr": 600_000}
    res = client.post("/v1/society/solar", headers=admin, json=body).json()["data"]
    out: dict[str, Any] = res["common_solar"]["result"]
    assert out["subsidy_inr"] == 3 * 18_000
    assert out["net_cost_inr"] == 600_000 - 54_000


def test_common_solar_errors(client: TestClient, mint_token: MintToken) -> None:
    make_society(client, mint_token)
    no_location = auth(mint_token, "anika")
    r = client.post("/v1/society/solar", headers=no_location, json=COMMON)
    assert r.status_code == 422 and r.json()["error"]["code"] == "location_needed"
    admin = located(client, mint_token, "anika")
    r = client.post("/v1/society/solar", headers=admin, json={**COMMON, "discom": "nowhere"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unknown_discom"
    r = client.post("/v1/society/solar", headers=admin, json={**COMMON, "monthly_units": 0})
    assert r.status_code == 422
    outsider = located(client, mint_token, "zed")
    assert client.post("/v1/society/solar", headers=outsider, json=COMMON).status_code == 404
