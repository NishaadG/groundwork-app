from fastapi.testclient import TestClient

from app.storage import owns_key
from tests.conftest import MintToken


def test_presign_scopes_key_to_user(client: TestClient, mint_token: MintToken) -> None:
    h = {"Authorization": f"Bearer {mint_token('erin')}"}
    r = client.post(
        "/v1/uploads/presign", headers=h, json={"kind": "bill", "content_type": "application/pdf"}
    )
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["key"].startswith("uploads/erin/bill/") and data["key"].endswith(".pdf")
    assert data["fields"]["Content-Type"] == "application/pdf"
    assert data["fields"]["key"] == data["key"]
    assert data["expires_in"] == 300
    assert "policy" in {k.lower() for k in data["fields"]}


def test_presign_rejects_wrong_types(client: TestClient, mint_token: MintToken) -> None:
    h = {"Authorization": f"Bearer {mint_token('erin')}"}
    r = client.post(
        "/v1/uploads/presign", headers=h, json={"kind": "meter", "content_type": "application/pdf"}
    )
    assert r.status_code == 415 and r.json()["error"]["code"] == "unsupported_file_type"
    r = client.post(
        "/v1/uploads/presign", headers=h, json={"kind": "selfie", "content_type": "image/png"}
    )
    assert r.status_code == 422


def test_presign_requires_sign_in(client: TestClient) -> None:
    r = client.post("/v1/uploads/presign", json={"kind": "bill", "content_type": "image/png"})
    assert r.status_code == 401


def test_owns_key() -> None:
    assert owns_key("erin", "uploads/erin/bill/a.jpg")
    assert not owns_key("erin", "uploads/erina/bill/a.jpg")
    assert not owns_key("erin", "uploads/erin/../frank/a.jpg")
    assert not owns_key("erin", "other/erin/a.jpg")
