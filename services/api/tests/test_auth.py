import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import MintToken


def get_me(client: TestClient, token: str | None) -> tuple[int, dict[str, Any]]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    res = client.get("/v1/me", headers=headers)
    return res.status_code, res.json()


def test_missing_token(client: TestClient) -> None:
    status, body = get_me(client, None)
    assert status == 401
    assert body == {
        "data": None,
        "error": {"code": "not_signed_in", "message": "Sign in to continue."},
    }


def test_valid_token(client: TestClient, mint_token: MintToken) -> None:
    status, body = get_me(client, mint_token("abc"))
    assert status == 200
    assert body["data"]["email"] == "abc@example.com"


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"exp": int(time.time()) - 120}, "token_expired"),
        ({"aud": "someone-else"}, "invalid_token"),
        ({"iss": "https://evil.example.com/pool"}, "invalid_token"),
        ({"token_use": "access"}, "invalid_token"),
        ({"token_use": None}, "invalid_token"),
    ],
)
def test_rejected_tokens(
    client: TestClient, mint_token: MintToken, overrides: dict[str, Any], code: str
) -> None:
    status, body = get_me(client, mint_token(**overrides))
    assert status == 401
    assert body["error"]["code"] == code


def test_tampered_token(client: TestClient, mint_token: MintToken) -> None:
    head, payload, sig = mint_token().split(".")
    tail = "BBBB" if sig.endswith("AAAA") else "AAAA"
    forged = ".".join([head, payload, sig[:-4] + tail])
    status, body = get_me(client, forged)
    assert status == 401 and body["error"]["code"] == "invalid_token"


def test_unsigned_token_rejected(client: TestClient) -> None:
    import jwt

    token = jwt.encode({"sub": "x", "token_use": "id"}, key="", algorithm="none")
    status, _ = get_me(client, token)
    assert status == 401
