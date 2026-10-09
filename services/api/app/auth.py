"""Cognito ID-token verification.

The user id is the verified token's `sub`, and only that. No route reads a user
id from the request body or from model output.
"""

from dataclasses import dataclass
from functools import cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.errors import ApiError


@dataclass(frozen=True)
class User:
    sub: str
    email: str | None
    username: str


@cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    # Caches signing keys in memory; refetches on unknown `kid` (key rotation).
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=6 * 3600, timeout=5)


def verify_id_token(token: str, settings: Settings) -> dict[str, Any]:
    if not settings.cognito_user_pool_id or not settings.cognito_client_ids:
        raise ApiError(503, "auth_not_configured", "Sign-in is not configured on this server.")
    try:
        key = _jwks_client(settings.jwks_url).get_signing_key_from_jwt(token)
        claims: dict[str, Any] = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.cognito_client_ids,
            issuer=settings.cognito_issuer,
            options={"require": ["exp", "iat", "sub", "aud", "iss", "token_use"]},
            leeway=30,
        )
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "token_expired", "Your session has expired.") from exc
    except (jwt.PyJWKClientError, jwt.InvalidTokenError) as exc:
        raise ApiError(401, "invalid_token", "Sign-in token is not valid.") from exc
    if claims.get("token_use") != "id":
        raise ApiError(401, "invalid_token", "An ID token is required.")
    return claims


def current_user(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> User:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "not_signed_in", "Sign in to continue.")
    claims = verify_id_token(token, settings)
    return User(
        sub=str(claims["sub"]),
        email=claims.get("email"),
        username=str(claims.get("cognito:username", claims["sub"])),
    )


CurrentUser = Annotated[User, Depends(current_user)]
