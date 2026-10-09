from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.calc.report_card import BillPoint, electricity_card, grade_for
from app.services import irradiance, ledger
from app.services.home import refresh_installed
from tests.conftest import MintToken
from tests.test_solar_api import PUNE_SUN, ROOF, save_bill


@pytest.fixture(autouse=True)
def _sun(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(irradiance, "fetch_nasa", lambda lat, lng: PUNE_SUN)


def auth(mint: MintToken, sub: str = "homer") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def make_report(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    bill_id = save_bill(client, h)
    return dict(
        client.post("/v1/solar/reports", headers=h, json={"bill_id": bill_id, "roof": ROOF}).json()[
            "data"
        ]
    )


@pytest.mark.parametrize(
    ("pct", "grade"),
    [(-30, "A"), (-15, "A"), (-10, "B"), (0, "C"), (5, "C"), (10, "D"), (15, "D"), (40, "E")],
)
def test_grade_bands(pct: float, grade: str) -> None:
    assert grade_for(pct) == grade


def test_electricity_card_needs_two_dated_bills() -> None:
    one = [BillPoint(units=300, period_start=date(2026, 7, 1), period_end=date(2026, 7, 31))]
    assert electricity_card(one) is None
    two = one + [BillPoint(units=240, period_start=date(2026, 8, 1), period_end=date(2026, 8, 31))]
    card = electricity_card(two)
    assert card is not None
    assert card.change_pct == pytest.approx(-20.0)
    assert card.grade == "A"
    assert card.working.result == "A"


def test_months_between_prorates_partial_months() -> None:
    months = ledger.months_between(date(2026, 1, 16), date(2026, 3, 10))
    assert [m for m, _ in months] == ["2026-01", "2026-02", "2026-03"]
    assert months[0][1] == pytest.approx(16 / 31)
    assert months[1][1] == pytest.approx(1.0)
    assert months[2][1] == pytest.approx(10 / 31)


def test_ledger_totals_equal_sum_of_entries(client: TestClient, mint_token: MintToken) -> None:
    """Totals always equal the sum of the underlying entries."""
    h = auth(mint_token)
    rep = make_report(client, h)
    client.post(
        f"/v1/solar/reports/{rep['id']}/installed", headers=h, json={"installed_on": "2026-06-15"}
    )
    data = client.get("/v1/ledger", headers=h).json()["data"]
    raw = ledger.entries("homer")
    for basis in ("projected", "estimated", "measured"):
        for metric in ("inr", "kwh", "co2_t"):
            expected = sum(e["value"] for e in raw if e["basis"] == basis and e["metric"] == metric)
            assert data[basis].get(metric, 0) == pytest.approx(expected, abs=0.001)
    for metric, months in data["series"].items():
        total = sum(v.get("estimated", 0) for v in months.values())
        assert total == pytest.approx(data["estimated"][metric], abs=0.01)


def test_mark_installed_moves_projection_to_estimates(
    client: TestClient, mint_token: MintToken
) -> None:
    h = auth(mint_token)
    rep = make_report(client, h)
    before = client.get("/v1/ledger", headers=h).json()["data"]
    assert before["projected"]["kwh"] > 0 and before["estimated"] == {}

    r = client.post(
        f"/v1/solar/reports/{rep['id']}/installed", headers=h, json={"installed_on": "2026-08-01"}
    )
    assert r.status_code == 200
    after = client.get("/v1/ledger", headers=h).json()["data"]
    assert after["projected"] == {}
    gen = rep["report"]["generation_kwh"]
    # Aug + Sep in full, plus Oct up to today (the test runs in or after Oct 2026)
    assert after["estimated"]["kwh"] >= gen[7] + gen[8] - 0.01

    home = client.get("/v1/home", headers=h).json()["data"]
    assert home["installed"]["report_id"] == rep["id"]
    steps = {w["id"]: w for w in home["ledger_working"]}
    assert steps["ledger_kwh"]["result"] == pytest.approx(after["estimated"]["kwh"], abs=0.01)
    assert steps["ledger_kwh"]["inputs"]["installed_on"] == "2026-08-01"
    assert home["next_action"]["kind"] == "log_bill"

    client.delete("/v1/solar/installed", headers=h)
    undone = client.get("/v1/ledger", headers=h).json()["data"]
    assert undone["estimated"] == {} and undone["projected"]["kwh"] == pytest.approx(
        rep["report"]["annual_generation_kwh"]
    )


def test_install_date_cannot_be_in_future(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token)
    rep = make_report(client, h)
    r = client.post(
        f"/v1/solar/reports/{rep['id']}/installed", headers=h, json={"installed_on": "2099-01-01"}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "future_date"


def test_refresh_extends_estimates_month_by_month(
    client: TestClient, mint_token: MintToken
) -> None:
    h = auth(mint_token)
    rep = make_report(client, h)
    client.post(
        f"/v1/solar/reports/{rep['id']}/installed", headers=h, json={"installed_on": "2026-08-01"}
    )
    refresh_installed("homer", today=date(2026, 12, 31))
    months = {e["month"] for e in ledger.entries("homer") if e["basis"] == "estimated"}
    assert months == {"2026-08", "2026-09", "2026-10", "2026-11", "2026-12"}


def test_next_action_rules(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token, "fresh")
    assert client.get("/v1/home", headers=h).json()["data"]["next_action"]["kind"] == "upload_bill"
    rep = make_report(client, h)
    na = client.get("/v1/home", headers=h).json()["data"]["next_action"]
    assert na == {
        "kind": "get_quotes",
        "kw": rep["report"]["size_kw"],
        "href": f"/app/solar/{rep['id']}",
    }
    # A second bill 40% higher per day than the first
    save_bill(client, h, units_kwh=392, period_start="2026-09-01", period_end="2026-09-30")
    home = client.get("/v1/home", headers=h).json()["data"]
    assert home["report_card"]["energy"]["grade"] == "E"
    assert home["next_action"]["kind"] == "bill_up"
    assert [a["type"] for a in home["activity"]][:1] == ["bill"]
    assert len(home["bills"]) == 2
