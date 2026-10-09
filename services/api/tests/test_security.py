"""Security sweep: every route needs a valid token unless it is deliberately public,
request bodies can't smuggle in another user's id, and bad tokens are refused."""

import re
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import MintToken

# Routes that are public on purpose, each with its own protection
PUBLIC = {
    ("GET", "/health"),  # liveness only
    ("GET", "/v1/public/share/{token}"),  # unguessable share token, 30-day expiry
    ("POST", "/v1/public/partners"),  # recycler applications, approved by hand
    ("POST", "/v1/iot/ingest"),  # device key in X-Device-Key
}


def routes() -> list[tuple[str, str]]:
    out = []
    for r in app.routes:
        if isinstance(r, APIRoute):
            for m in r.methods - {"HEAD", "OPTIONS"}:
                out.append((m, r.path))
    return sorted(out)


def test_public_list_matches_reality() -> None:
    """If a public route is added or removed, this list must be updated on purpose."""
    found = set(routes())
    assert PUBLIC <= found, PUBLIC - found


@pytest.mark.parametrize(("method", "path"), [r for r in routes() if r not in PUBLIC])
def test_every_private_route_needs_a_token(client: TestClient, method: str, path: str) -> None:
    url = re.sub(r"\{[^}]+\}", "x1", path)
    r = client.request(method, url, json={})
    assert r.status_code == 401, f"{method} {path} answered {r.status_code} without a token"
    assert r.json()["error"]["code"] == "not_signed_in"


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": 1},  # expired
        {"aud": "someone-else"},  # wrong app
        {"iss": "https://cognito-idp.ap-south-1.amazonaws.com/other-pool"},  # wrong pool
        {"token_use": "access"},  # access token, not an ID token
    ],
)
def test_bad_tokens_are_refused(
    client: TestClient, mint_token: MintToken, claims: dict[str, Any]
) -> None:
    r = client.get("/v1/me", headers={"Authorization": f"Bearer {mint_token('u1', **claims)}"})
    assert r.status_code == 401


def test_body_cannot_name_another_user(client: TestClient, mint_token: MintToken) -> None:
    h = {"Authorization": f"Bearer {mint_token('u1')}"}
    for path, body in (
        ("/v1/me", {"name": "x", "sub": "victim"}),
        ("/v1/waste/scans", {"items": [{"material": "pet", "kg": 1}], "sub": "victim"}),
        ("/v1/society", {"name": "Acres", "city": "Pune", "flats": 10, "user_id": "victim"}),
        ("/v1/chat", {"message": "hi", "sub": "victim"}),
    ):
        method = "PUT" if path == "/v1/me" else "POST"
        r = client.request(method, path, headers=h, json=body)
        assert r.status_code == 422, f"{path} accepted an extra user field"


def test_uploads_are_scoped_to_the_signed_in_user(
    client: TestClient, mint_token: MintToken
) -> None:
    h = {"Authorization": f"Bearer {mint_token('u1')}"}
    r = client.post(
        "/v1/uploads/presign", headers=h, json={"kind": "bill", "content_type": "image/jpeg"}
    )
    assert r.json()["data"]["key"].startswith("uploads/u1/bill/")
    # Someone else's key is refused by every reader
    for path, body in (
        ("/v1/bills/extract", {"s3_key": "uploads/u2/bill/a.jpg"}),
        ("/v1/water/meter-photo", {"s3_key": "uploads/u2/meter/a.jpg"}),
        ("/v1/waste/scan", {"s3_key": "uploads/u2/waste/a.jpg"}),
    ):
        assert client.post(path, headers=h, json=body).status_code == 404, path
