from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import MintToken


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_onboarding_saves_step_by_step(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token("u1"))
    first = client.get("/v1/me", headers=h).json()["data"]
    assert first == {"email": "u1@example.com", "onboarding_step": 0, "onboarding_done": False}

    r = client.put("/v1/me", headers=h, json={"name": "Priya", "lang": "en", "onboarding_step": 1})
    assert r.status_code == 200
    created = r.json()["data"]["created_at"]

    r = client.put(
        "/v1/me",
        headers=h,
        json={
            "home_type": "flat",
            "city": "Pune",
            "lat": 18.52,
            "lng": 73.86,
            "household_size": 4,
            "roof_area_sqft": 350.5,
            "onboarding_step": 2,
        },
    )
    data = r.json()["data"]
    assert data["name"] == "Priya" and data["city"] == "Pune"
    assert data["roof_area_sqft"] == 350.5 and data["household_size"] == 4
    assert data["created_at"] == created  # set once, never overwritten

    # A refresh (new GET) sees everything saved so far
    again = client.get("/v1/me", headers=h).json()["data"]
    assert again["lat"] == 18.52 and again["onboarding_step"] == 2


def test_null_clears_a_field(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token("u2"))
    client.put("/v1/me", headers=h, json={"tank_litres": 1000})
    data = client.put("/v1/me", headers=h, json={"tank_litres": None}).json()["data"]
    assert data.get("tank_litres") is None


def test_validation_errors_use_the_envelope(client: TestClient, mint_token: MintToken) -> None:
    h = auth(mint_token("u3"))
    r = client.put("/v1/me", headers=h, json={"lat": 120, "discom": "made-up"})
    assert r.status_code == 422
    body = r.json()
    assert body["data"] is None and body["error"]["code"] == "validation_failed"
    assert {d["field"] for d in body["error"]["details"]} == {"lat", "discom"}


def test_user_id_never_comes_from_the_body(client: TestClient, mint_token: MintToken) -> None:
    """Extra fields (like a smuggled sub/user id) are rejected outright."""
    h = auth(mint_token("u4"))
    r = client.put("/v1/me", headers=h, json={"name": "A", "sub": "victim"})
    assert r.status_code == 422
    r = client.put("/v1/me", headers=h, json={"name": "A", "PK": "USER#victim"})
    assert r.status_code == 422


def test_users_are_isolated(client: TestClient, mint_token: MintToken) -> None:
    client.put("/v1/me", headers=auth(mint_token("alice")), json={"name": "Alice"})
    bob = client.get("/v1/me", headers=auth(mint_token("bob"))).json()["data"]
    assert "name" not in bob


def test_export_and_delete_remove_everything(
    client: TestClient, mint_token: MintToken, aws: dict[str, Any]
) -> None:
    sub = "carol"
    aws["cognito"].admin_create_user(UserPoolId=aws["pool_id"], Username=sub)
    h = auth(mint_token(sub))
    client.put("/v1/me", headers=h, json={"name": "Carol", "city": "Mumbai"})
    # A file under the user's prefix, and one belonging to someone else
    aws["s3"].put_object(
        Bucket="groundwork-uploads-test", Key=f"uploads/{sub}/bill/a.jpg", Body=b"x"
    )
    aws["s3"].put_object(Bucket="groundwork-uploads-test", Key="uploads/dave/bill/b.jpg", Body=b"x")

    export = client.get("/v1/me/export", headers=h).json()["data"]
    assert [i["SK"] for i in export["items"]] == ["PROFILE"]
    assert all("PK" not in i for i in export["items"])

    res = client.delete("/v1/me", headers=h).json()["data"]
    assert res == {"deleted_items": 1, "deleted_files": 1}

    assert client.get("/v1/me", headers=h).json()["data"]["onboarding_step"] == 0
    keys = [
        o["Key"] for o in aws["s3"].list_objects_v2(Bucket="groundwork-uploads-test")["Contents"]
    ]
    assert keys == ["uploads/dave/bill/b.jpg"]
    users = aws["cognito"].list_users(UserPoolId=aws["pool_id"])["Users"]
    assert users == []


def test_unknown_route_uses_envelope(client: TestClient) -> None:
    r = client.get("/v1/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
