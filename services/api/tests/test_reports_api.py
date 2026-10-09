import pytest
from fastapi.testclient import TestClient

from tests.conftest import MintToken
from tests.test_solar_api import save_bill


def h(mint: MintToken, sub: str = "rita") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def test_empty_account(client: TestClient, mint_token: MintToken) -> None:
    d = client.get("/v1/reports", headers=h(mint_token)).json()["data"]
    assert d["solar_reports"] == [] and d["cards"] == []
    imp = d["impact"]
    assert imp["since"] is None and imp["ledger"]["estimated"] == {}
    assert imp["activity"]["waste_scans"] == 0
    # Every listed source says where it comes from
    assert all(s["source"] for s in imp["sources"])
    assert any("WARM" in s["source"] for s in imp["sources"])


def test_card_history_one_per_bill_after_the_first(
    client: TestClient, mint_token: MintToken
) -> None:
    headers = h(mint_token)
    for start, end, units in (
        ("2026-06-01", "2026-06-30", 300),
        ("2026-07-01", "2026-07-31", 310),
        ("2026-08-01", "2026-08-31", 248),
    ):
        save_bill(client, headers, period_start=start, period_end=end, units_kwh=units)
    cards = client.get("/v1/reports", headers=headers).json()["data"]["cards"]
    assert [c["period_end"] for c in cards] == ["2026-08-31", "2026-07-31"]
    # August: 8 kWh/day vs the mean of June (10) and July (10) per day
    assert cards[0]["change_pct"] == pytest.approx(-20.0)
    assert cards[0]["grade"] == "A"
    assert cards[1]["change_pct"] == pytest.approx(0.0)


def test_impact_counts_waste_with_working(client: TestClient, mint_token: MintToken) -> None:
    headers = h(mint_token)
    client.post(
        "/v1/waste/scans",
        headers=headers,
        json={"items": [{"material": "newspaper", "kg": 5}, {"material": "sanitary", "kg": 1}]},
    )
    imp = client.get("/v1/reports", headers=headers).json()["data"]["impact"]
    assert imp["activity"]["waste_kg"] == 6 and imp["activity"]["waste_kg_diverted"] == 5
    assert imp["ledger"]["measured"]["kg"] == 5
    assert {w["id"] for w in imp["working"]} == {"ledger_kg", "ledger_co2_t"}
    assert imp["since"] is not None
    assert imp["name"] == "rita@example.com"  # no profile name yet, so the account email
