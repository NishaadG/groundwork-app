"""Runtime settings from the environment (SAM template / .env). No secrets in code."""

import json
from functools import cache
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    stage: Literal["local", "test", "dev", "prod"] = "local"
    aws_region: str = "ap-south-1"

    table_name: str = "groundwork-local"
    uploads_bucket: str = "groundwork-uploads-local"

    # Cognito (from Amplify Gen 2 outputs)
    cognito_region: str = "ap-south-1"
    cognito_user_pool_id: str = ""
    cognito_client_ids: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Override for tests; defaults to the pool's public JWKS URL
    cognito_jwks_url: str = ""

    # Web origins allowed by CORS
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    # Bedrock: Nova Lite via the APAC cross-region inference profile
    bedrock_region: str = "ap-south-1"
    vision_model_id: str = "apac.amazon.nova-lite-v1:0"
    text_model_id: str = "apac.amazon.nova-lite-v1:0"
    ai_calls_per_hour: int = 30

    # Alternatives to Bedrock. openai: any OpenAI-compatible endpoint for photos and the copilot.
    # gemini: Gemini's OpenAI-compatible endpoint for photos, its native API for the copilot
    # (multi-turn tool use there needs thought signatures passed back, which only it keeps).
    # The key lives in SSM (SecureString); AI_API_KEY is for local runs only.
    ai_provider: Literal["bedrock", "openai", "gemini"] = "bedrock"
    ai_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    ai_model: str = "gemini-3.5-flash"
    # The copilot can use its own model, so its free-tier daily quota is separate from photo reading
    ai_copilot_model: str = ""
    ai_fallback_models: str = (
        "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash,"
        "gemini-3.7-flash,gemini-3.8-flash"
    )
    ai_reasoning_effort: str = ""
    # Reuse the stored answer for an identical photo and prompt (saves free-tier quota)
    ai_cache: bool = False
    ai_key_param: str = ""
    ai_api_key: str = ""

    # SES sender for pickup emails; empty = no email (the partner's phone is shown instead)
    email_from: str = ""
    # Public site address, for links in emails
    site_url: str = "http://localhost:3000"

    presign_expiry_seconds: int = 300
    max_upload_bytes: int = 10 * 1024 * 1024

    @field_validator("cognito_client_ids", "cors_origins", mode="before")
    @classmethod
    def _list(cls, v: Any) -> Any:
        """Lists come from the environment as JSON or as comma-separated text."""
        if isinstance(v, str):
            text = v.strip()
            if text.startswith("["):
                return json.loads(text)
            return [p.strip() for p in text.split(",") if p.strip()]
        return v

    @property
    def cognito_issuer(self) -> str:
        return (
            f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_user_pool_id}"
        )

    @property
    def jwks_url(self) -> str:
        return self.cognito_jwks_url or f"{self.cognito_issuer}/.well-known/jwks.json"


@cache
def get_settings() -> Settings:
    return Settings()
