"""The AI service behind photo reading, tips and the copilot.

Bedrock by default. With AI_PROVIDER=openai or gemini, an OpenAI-compatible endpoint (for
example Gemini's) reads photos and writes tips instead: `client().converse(**kw)` takes the
same Converse request the call sites already send and returns a Converse-shaped response,
so prompts and schemas don't change.
"""

import base64
import json
import logging
from functools import cache
from typing import Any

import boto3
from botocore.config import Config

from app.config import get_settings

log = logging.getLogger("groundwork.ai")


class AiUnavailable(Exception):
    """The AI service refused for account or quota reasons, or can't take this input.
    Callers fall back to manual entry (photos) or the rule-based answers (copilot)."""


@cache
def _bedrock() -> Any:
    s = get_settings()
    return boto3.client(
        "bedrock-runtime",
        region_name=s.bedrock_region,
        config=Config(read_timeout=60, retries={"max_attempts": 2, "mode": "standard"}),
    )


@cache
def api_key() -> str:
    """The OpenAI-compatible key: AI_API_KEY for local runs, else the SSM SecureString."""
    s = get_settings()
    if s.ai_api_key:
        return s.ai_api_key
    if not s.ai_key_param:
        raise AiUnavailable("no AI key configured")
    ssm = boto3.client("ssm", region_name=s.aws_region)
    return str(ssm.get_parameter(Name=s.ai_key_param, WithDecryption=True)["Parameter"]["Value"])


def openai_params(temperature: float, max_tokens: int) -> dict[str, Any]:
    s = get_settings()
    params: dict[str, Any] = {"temperature": temperature, "max_tokens": max_tokens}
    if s.ai_reasoning_effort:
        params["reasoning_effort"] = s.ai_reasoning_effort
    return params


# ---- Converse -> OpenAI chat completions ----


def _content(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in blocks:
        if "text" in b:
            out.append({"type": "text", "text": b["text"]})
        elif "image" in b:
            fmt = b["image"]["format"]
            data = base64.b64encode(b["image"]["source"]["bytes"]).decode()
            url = f"data:image/{fmt};base64,{data}"
            out.append({"type": "image_url", "image_url": {"url": url}})
        else:
            # PDFs and anything else: the endpoint takes images only, so use manual entry.
            raise AiUnavailable(f"unsupported content block: {sorted(b)}")
    return out


def to_openai(
    model: str,
    messages: list[dict[str, Any]],
    system: list[dict[str, Any]] | None = None,
    toolConfig: dict[str, Any] | None = None,  # noqa: N803 (Converse's name)
    inferenceConfig: dict[str, Any] | None = None,  # noqa: N803
) -> dict[str, Any]:
    msgs: list[dict[str, Any]] = []
    if system:
        msgs.append({"role": "system", "content": "\n\n".join(p["text"] for p in system)})
    for m in messages:
        msgs.append({"role": m["role"], "content": _content(m["content"])})
    inf = inferenceConfig or {}
    req: dict[str, Any] = {
        "model": model,
        "messages": msgs,
        **openai_params(inf.get("temperature", 0), max(int(inf.get("maxTokens", 1000)), 1000)),
    }
    if toolConfig:
        req["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t["toolSpec"]["name"],
                    "description": t["toolSpec"].get("description", ""),
                    "parameters": t["toolSpec"]["inputSchema"]["json"],
                },
            }
            for t in toolConfig["tools"]
        ]
        choice = toolConfig.get("toolChoice") or {}
        if "tool" in choice:
            req["tool_choice"] = {"type": "function", "function": {"name": choice["tool"]["name"]}}
        elif "any" in choice:
            req["tool_choice"] = "required"
    return req


def from_openai(res: Any) -> dict[str, Any]:
    choice = res.choices[0]
    content: list[dict[str, Any]] = []
    if choice.message.content:
        content.append({"text": choice.message.content})
    for call in choice.message.tool_calls or []:
        try:
            args = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError:
            log.warning("tool call arguments were not JSON")
            continue
        use = {"toolUseId": call.id, "name": call.function.name, "input": args}
        content.append({"toolUse": use})
    stop = {"tool_calls": "tool_use", "length": "max_tokens"}.get(choice.finish_reason, "end_turn")
    return {"output": {"message": {"role": "assistant", "content": content}}, "stopReason": stop}


# Errors that mean "not available to us right now", not "bad photo".
_UNAVAILABLE = ("AuthenticationError", "PermissionDeniedError", "RateLimitError", "NotFoundError")


class OpenAIConverse:
    """A Bedrock-runtime look-alike over an OpenAI-compatible client (only `.converse`)."""

    def __init__(self, client: Any, model: str, fallbacks: tuple[str, ...] = ()) -> None:
        self.client = client
        self.model = model
        self.fallbacks = fallbacks

    def converse(self, *, modelId: str = "", **kw: Any) -> dict[str, Any]:  # noqa: N803
        """Try the main model, then each fallback when one is out of quota (free-tier limits
        are per model) or gone."""
        failure: AiUnavailable | None = None
        for model in (self.model, *self.fallbacks):
            try:
                return self._one(to_openai(model, **kw))
            except AiUnavailable as exc:
                failure = exc
                log.warning("model %s unavailable, trying the next: %s", model, str(exc)[:120])
        assert failure is not None
        raise failure

    def _one(self, req: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        # A forced tool is sometimes answered with text instead; ask once more.
        for _ in range(2 if "tool_choice" in req else 1):
            try:
                res = self.client.chat.completions.create(**req)
            except Exception as exc:
                if type(exc).__name__ in _UNAVAILABLE:
                    raise AiUnavailable(f"{type(exc).__name__}: {exc}") from exc
                raise
            out = from_openai(res)
            if any("toolUse" in p for p in out["output"]["message"]["content"]):
                break
        return out


@cache
def _openai_converse() -> OpenAIConverse:
    import openai

    s = get_settings()
    return OpenAIConverse(
        openai.OpenAI(api_key=api_key(), base_url=s.ai_base_url, timeout=60, max_retries=2),
        s.ai_model,
        tuple(m.strip() for m in s.ai_fallback_models.split(",") if m.strip()),
    )


def client() -> Any:
    """Something with Bedrock's `.converse(**kw)` for the configured provider."""
    if get_settings().ai_provider in ("openai", "gemini"):
        return _openai_converse()
    return _bedrock()
