import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import db
from app.services import society
from tests.conftest import MintToken


def auth(mint: MintToken, sub: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def make_society(client: TestClient, mint: MintToken, **extra: Any) -> dict[str, Any]:
    body = {"name": "Green Acres CHS", "city": "Pune", "flats": 40, **extra}
    r = client.post("/v1/society", headers=auth(mint, "anika"), json=body)
    assert r.status_code == 200, r.json()
    data: dict[str, Any] = r.json()["data"]
    return data


def test_not_in_a_society(client: TestClient, mint_token: MintToken) -> None:
    assert client.get("/v1/society", headers=auth(mint_token, "anika")).json()["data"] is None


def test_two_members_see_correct_aggregates_and_nothing_private(
    client: TestClient, mint_token: MintToken
) -> None:
    a = make_society(client, mint_token, nickname="Sunflower", leaderboard_opt_in=True)
    assert a["is_admin"] and a["members"] == 1 and len(a["invite_code"]) == 8

    # Codes are forgiving about case and spacing
    code = a["invite_code"].lower()
    b_h = auth(mint_token, "bharat")
    joined = client.post(
        "/v1/society/join",
        headers=b_h,
        json={"code": f"{code[:4]} {code[4:]}", "flat_label": "B-12"},
    ).json()["data"]
    assert joined["members"] == 2 and joined["is_admin"] is False

    # Bharat logs waste; Anika has no entries
    client.post(
        "/v1/waste/scans", headers=b_h, json={"items": [{"material": "newspaper", "kg": 5}]}
    )

    dash = client.get("/v1/society", headers=auth(mint_token, "anika")).json()["data"]
    assert dash["totals"]["realised"]["kg"] == 5
    assert dash["participation_pct"] == 5.0  # 2 of 40 flats
    part = next(w for w in dash["working"] if w["id"] == "society_participation")
    assert part["inputs"] == {"households": 2, "flats": 40}

    # Only the opted-in member is on the leaderboard; Bharat is counted, not named
    assert [r["name"] for r in dash["leaderboard"]] == ["Sunflower"]
    assert dash["leaderboard_hidden"] == 1
    raw = json.dumps(dash)
    for private in ("bharat", "B-12", "Newspaper"):
        assert private not in raw

    # Bharat sees the same totals, but not admin-only details beyond the shared code
    b_dash = client.get("/v1/society", headers=b_h).json()["data"]
    assert b_dash["totals"] == dash["totals"] and b_dash["me"]["flat_label"] == "B-12"
    assert "anika" not in json.dumps(b_dash)


def test_leaderboard_ranks_by_own_baseline(
    client: TestClient, mint_token: MintToken, monkeypatch: pytest.MonkeyPatch
) -> None:
    a = make_society(client, mint_token, nickname="A", leaderboard_opt_in=True)
    for sub, nick in (("b1", "B"), ("c1", "C"), ("d1", "D")):
        client.post(
            "/v1/society/join",
            headers=auth(mint_token, sub),
            json={"code": a["invite_code"], "nickname": nick, "leaderboard_opt_in": True},
        )
    change = {"anika": -3.0, "b1": -20.0, "c1": None, "d1": 8.0}
    monkeypatch.setattr(
        society,
        "_energy_change",
        lambda sub: None if change[sub] is None else {"change_pct": change[sub], "grade": "B"},
    )
    board = client.get("/v1/society", headers=auth(mint_token, "c1")).json()["data"]["leaderboard"]
    assert [r["name"] for r in board] == ["B", "A", "D", "C"]  # no baseline yet goes last
    assert [r["is_you"] for r in board] == [False, False, False, True]


def test_member_settings_and_opt_out(client: TestClient, mint_token: MintToken) -> None:
    make_society(client, mint_token, leaderboard_opt_in=True, flat_label="A-302")
    h = auth(mint_token, "anika")
    d = client.put("/v1/society/me", headers=h, json={"leaderboard_opt_in": False}).json()["data"]
    assert d["leaderboard"] == [] and d["leaderboard_hidden"] == 1
    assert d["me"] == {"flat_label": "A-302", "nickname": None, "leaderboard_opt_in": False}


def test_admin_tools_are_admin_only(client: TestClient, mint_token: MintToken) -> None:
    a = make_society(client, mint_token)
    a_h, b_h = auth(mint_token, "anika"), auth(mint_token, "bharat")
    client.post("/v1/society/join", headers=b_h, json={"code": a["invite_code"]})

    assert (
        client.post("/v1/society/announcements", headers=b_h, json={"text": "Hi"}).status_code
        == 403
    )
    assert (
        client.post(
            "/v1/society/tanks", headers=b_h, json={"name": "Main", "level_pct": 50}
        ).status_code
        == 403
    )

    anns = client.post(
        "/v1/society/announcements", headers=a_h, json={"text": "Water off on Sunday 10–12."}
    ).json()["data"]["announcements"]
    client.post("/v1/society/tanks", headers=a_h, json={"name": "Main", "level_pct": 80})
    client.post("/v1/society/tanks", headers=a_h, json={"name": "main", "level_pct": 65})
    b_dash = client.get("/v1/society", headers=b_h).json()["data"]
    assert [x["text"] for x in b_dash["announcements"]] == ["Water off on Sunday 10–12."]
    assert len(b_dash["tanks"]) == 1 and b_dash["tanks"][0]["level_pct"] == 65
    assert len(b_dash["tanks"][0]["history"]) == 2

    assert (
        client.delete(f"/v1/society/announcements/{anns[0]['id']}", headers=b_h).status_code == 403
    )
    client.delete(f"/v1/society/announcements/{anns[0]['id']}", headers=a_h)
    assert client.get("/v1/society", headers=b_h).json()["data"]["announcements"] == []


def test_join_errors(client: TestClient, mint_token: MintToken) -> None:
    a = make_society(client, mint_token)
    r = client.post("/v1/society/join", headers=auth(mint_token, "x"), json={"code": "ZZZZZZZZ"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "invite_not_found"
    again = client.post(
        "/v1/society/join", headers=auth(mint_token, "anika"), json={"code": a["invite_code"]}
    )
    assert again.status_code == 409


def test_leaving_hands_over_admin_and_last_member_deletes(
    client: TestClient, mint_token: MintToken
) -> None:
    a = make_society(client, mint_token)
    a_h, b_h = auth(mint_token, "anika"), auth(mint_token, "bharat")
    client.post("/v1/society/join", headers=b_h, json={"code": a["invite_code"]})
    # Leaving keeps your own records
    client.post("/v1/waste/scans", headers=a_h, json={"items": [{"material": "pet", "kg": 1}]})

    client.delete("/v1/society/me", headers=a_h)
    assert client.get("/v1/society", headers=a_h).json()["data"] is None
    assert client.get("/v1/ledger", headers=a_h).json()["data"]["entries"] > 0
    b = client.get("/v1/society", headers=b_h).json()["data"]
    assert b["is_admin"] and b["members"] == 1 and b["totals"]["realised"] == {}

    client.delete("/v1/society/me", headers=b_h)
    left = db.table().query(
        KeyConditionExpression="PK = :p", ExpressionAttributeValues={":p": f"SOCIETY#{a['id']}"}
    )
    assert left["Items"] == []
    r = client.post("/v1/society/join", headers=a_h, json={"code": a["invite_code"]})
    assert r.status_code == 404


def test_deleting_account_leaves_society(client: TestClient, mint_token: MintToken) -> None:
    a = make_society(client, mint_token)
    b_h = auth(mint_token, "bharat")
    client.post("/v1/society/join", headers=b_h, json={"code": a["invite_code"]})
    assert client.delete("/v1/me", headers=b_h).status_code == 200
    assert (
        client.get("/v1/society", headers=auth(mint_token, "anika")).json()["data"]["members"] == 1
    )
