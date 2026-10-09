"""Test fixtures: mocked AWS (moto) and locally signed Cognito-style ID tokens."""

import json
import os
import time
from collections.abc import Callable, Iterator
from typing import Any

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from moto import mock_aws

os.environ.update(
    {
        "STAGE": "test",
        "AWS_DEFAULT_REGION": "ap-south-1",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "TABLE_NAME": "groundwork-test",
        "UPLOADS_BUCKET": "groundwork-uploads-test",
        "COGNITO_USER_POOL_ID": "ap-south-1_testpool",
        "COGNITO_CLIENT_IDS": json.dumps(["web-client"]),
        "CORS_ORIGINS": json.dumps(["http://localhost:3000"]),
    }
)

from app import auth, db, storage  # noqa: E402
from app.config import get_settings  # noqa: E402

PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "test-key"


class _FakeJwks:
    def get_signing_key_from_jwt(self, token: str) -> Any:
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise jwt.PyJWKClientError("unknown kid")
        return jwt.PyJWK.from_dict(
            {
                **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(PRIVATE_KEY.public_key())),
                "kid": KID,
                "alg": "RS256",
                "use": "sig",
            }
        )


@pytest.fixture(autouse=True)
def _fake_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_jwks_client", lambda url: _FakeJwks())


MintToken = Callable[..., str]


@pytest.fixture
def mint_token() -> MintToken:
    def mint(sub: str = "user-1", **overrides: Any) -> str:
        s = get_settings()
        now = int(time.time())
        claims = {
            "sub": sub,
            "email": f"{sub}@example.com",
            "cognito:username": sub,
            "aud": "web-client",
            "iss": s.cognito_issuer,
            "token_use": "id",
            "iat": now,
            "exp": now + 3600,
        }
        claims.update(overrides)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, PRIVATE_KEY, algorithm="RS256", headers={"kid": KID})

    return mint


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    with mock_aws():
        get_settings.cache_clear()
        s = get_settings()
        ddb = boto3.client("dynamodb", region_name=s.aws_region)
        ddb.create_table(
            TableName=s.table_name,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": n, "AttributeType": "S"} for n in ("PK", "SK", "GSI1PK", "GSI1SK")
            ],
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "GSI1",
                    "KeySchema": [
                        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                        {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
        )
        s3 = boto3.client("s3", region_name=s.aws_region)
        s3.create_bucket(
            Bucket=s.uploads_bucket,
            CreateBucketConfiguration={"LocationConstraint": "ap-south-1"},
        )
        cognito = boto3.client("cognito-idp", region_name=s.aws_region)
        pool_id = cognito.create_user_pool(PoolName="test")["UserPool"]["Id"]
        monkeypatch.setenv("COGNITO_USER_POOL_ID", pool_id)
        get_settings.cache_clear()
        db.reset_clients()
        storage.reset_clients()
        yield {"s3": s3, "ddb": ddb, "cognito": cognito, "pool_id": pool_id}
        db.reset_clients()
        storage.reset_clients()
    get_settings.cache_clear()


@pytest.fixture
def client(aws: dict[str, Any]) -> TestClient:
    from app.main import create_app

    return TestClient(create_app())
