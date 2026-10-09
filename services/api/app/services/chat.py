"""Copilot chat: runs the agents for one message and streams Server-Sent Events.

Events: `token {text}`, `tool_start {name}`, `card {type, data}`,
`done {session_id, agents, tools}` and, on failure, `error {code, message}`.
"""

import json
import logging
import re
import secrets
import time
from collections.abc import AsyncIterator, Callable
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from strands.models import Model
from strands.models.bedrock import BedrockModel

from app import db, storage
from app.agents import copilot, rules
from app.agents.guard import untraced_numbers
from app.config import get_settings
from app.errors import ApiError
from app.services import ai, extraction

log = logging.getLogger("groundwork.chat")

HISTORY_TURNS = 10  # user + assistant pairs kept as context
HISTORY_DAYS = 30


class AttachmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["bill", "meter", "waste"]
    s3_key: str = Field(max_length=300)


class ChatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str | None = Field(default=None, pattern=r"^[a-z0-9]{8,32}$")
    message: str = Field(min_length=1, max_length=2000)
    attachment: AttachmentIn | None = None


def bedrock_model(role: copilot.Role) -> Model:
    s = get_settings()
    temperature = 0.2 if role == "orchestrator" else 0.3
    if s.ai_provider == "gemini":
        from strands.models.gemini import GeminiModel

        return GeminiModel(
            client_args={"api_key": ai.api_key()},
            model_id=s.ai_model,
            params={"temperature": temperature, "max_output_tokens": 1500},
        )
    if s.ai_provider == "openai":
        from strands.models.openai import OpenAIModel

        return OpenAIModel(
            client_args={"api_key": ai.api_key(), "base_url": s.ai_base_url},
            model_id=s.ai_model,
            params=ai.openai_params(temperature, 1500),
        )
    return BedrockModel(
        model_id=s.text_model_id,
        region_name=s.bedrock_region,
        temperature=0.2 if role == "orchestrator" else 0.3,
        max_tokens=700,
    )


# Tests swap this for a scripted model.
model_for: Callable[[copilot.Role], Model] = bedrock_model


def _history_key(sub: str, session_id: str) -> dict[str, str]:
    return {"PK": db.user_pk(sub), "SK": f"CHAT#{session_id}"}


def load_history(sub: str, session_id: str) -> list[dict[str, str]]:
    item = db.table().get_item(Key=_history_key(sub, session_id)).get("Item")
    return list(item["turns"]) if item else []


def save_history(sub: str, session_id: str, turns: list[dict[str, str]]) -> None:
    db.table().put_item(
        Item={
            **_history_key(sub, session_id),
            "turns": turns[-HISTORY_TURNS * 2 :],
            "updated_at": db.now_iso(),
            "expiresAt": int(time.time()) + HISTORY_DAYS * 86400,
        }
    )


def prepare(sub: str, body: ChatIn) -> tuple[str, copilot.Session]:
    """Checks that run before streaming starts, so they can fail as normal JSON errors."""
    attachment = None
    if body.attachment:
        a = body.attachment
        if not storage.owns_key(sub, a.s3_key) or f"/{a.kind}/" not in a.s3_key:
            raise ApiError(404, "upload_not_found", "That upload isn't in your account.")
        attachment = copilot.Attachment(kind=a.kind, s3_key=a.s3_key)
    extraction.check_rate_limit(sub)
    return body.session_id or secrets.token_hex(8), copilot.Session(sub=sub, attachment=attachment)


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


# When the model is unreachable for account reasons, answer with the rule-based copilot
# and skip the model for a while so replies stay quick.
MODEL_RETRY_SECONDS = 600
_model_down_until = 0.0


async def _rules_stream(
    sub: str, body: ChatIn, session_id: str, turns: list[dict[str, str]]
) -> AsyncIterator[str]:
    a = rules.answer(sub, body.message.strip())
    for name in a.tools:
        yield sse("tool_start", {"name": name})
    for card in a.cards:
        yield sse("card", card)
    for i in range(0, len(a.text), 24):
        yield sse("token", {"text": a.text[i : i + 24]})
    save_history(
        sub,
        session_id,
        [
            *turns,
            {"role": "user", "text": body.message.strip()},
            {"role": "assistant", "text": a.text},
        ],
    )
    yield sse("done", {"session_id": session_id, "agents": [], "tools": a.tools})


async def stream(
    sub: str, lang: str, body: ChatIn, session_id: str, session: copilot.Session
) -> AsyncIterator[str]:
    global _model_down_until
    turns = load_history(sub, session_id)
    if time.time() < _model_down_until:
        async for chunk in _rules_stream(sub, body, session_id, turns):
            yield chunk
        return
    history = [{"role": t["role"], "content": [{"text": t["text"]}]} for t in turns]
    text = body.message.strip()
    if session.attachment:
        text = f"[The user attached a {session.attachment.kind} photo.]\n{text}"

    reply: list[str] = []
    tools: list[str] = []
    seen_tool_ids: set[str] = set()
    sent_cards = 0
    try:
        agent = copilot.build(session, lang, model_for, history)
        async for ev in agent.stream_async(text):
            if "data" in ev and isinstance(ev["data"], str) and ev["data"]:
                reply.append(ev["data"])
                yield sse("token", {"text": ev["data"]})
            elif "current_tool_use" in ev:
                use = ev["current_tool_use"] or {}
                tid, name = use.get("toolUseId"), use.get("name")
                if tid and name and tid not in seen_tool_ids:
                    seen_tool_ids.add(tid)
                    tools.append(name)
                    if name.endswith("_agent"):
                        session.agents_used.append(name)
                    yield sse("tool_start", {"name": name})
            while sent_cards < len(session.cards):
                yield sse("card", session.cards[sent_cards])
                sent_cards += 1
    except ApiError as exc:
        yield sse("error", {"code": exc.code, "message": exc.message})
        return
    except Exception as exc:
        if extraction.ai_unavailable(exc) and not reply:
            log.warning("model unavailable; answering with the rule-based copilot")
            _model_down_until = time.time() + MODEL_RETRY_SECONDS
            async for chunk in _rules_stream(sub, body, session_id, turns):
                yield chunk
            return
        log.exception("copilot failed")
        yield sse(
            "error", {"code": "copilot_failed", "message": "Something went wrong. Try again."}
        )
        return

    answer = re.sub(r"\n{3,}", "\n\n", "".join(reply)).strip()
    untraced = untraced_numbers(answer, session.tool_results, body.message)
    if untraced:
        # Logged for the eval and monitoring; the reply has already streamed.
        log.warning("copilot reply had untraced numbers: %s", untraced)
    save_history(
        sub,
        session_id,
        [
            *turns,
            {"role": "user", "text": body.message.strip()},
            {"role": "assistant", "text": answer},
        ],
    )
    yield sse("done", {"session_id": session_id, "agents": session.agents_used, "tools": tools})
