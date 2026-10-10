"""The Converse <-> OpenAI-compatible adapter used when AI_PROVIDER=openai."""

import json
from types import SimpleNamespace as NS
from typing import Any

import pytest

from app.config import get_settings
from app.services import ai, extraction

SCHEMA = {"type": "object", "properties": {"reading": {"type": ["number", "null"]}}}


def converse_request(block: dict[str, Any]) -> dict[str, Any]:
    return {
        "modelId": "apac.amazon.nova-lite-v1:0",
        "system": [{"text": "Be careful."}],
        "messages": [{"role": "user", "content": [block, {"text": "Read the meter."}]}],
        "toolConfig": {
            "tools": [
                {
                    "toolSpec": {
                        "name": "record_meter",
                        "description": "Record the meter reading.",
                        "inputSchema": {"json": SCHEMA},
                    }
                }
            ],
            "toolChoice": {"tool": {"name": "record_meter"}},
        },
        "inferenceConfig": {"temperature": 0, "maxTokens": 300},
    }


def completion(args: str, finish: str = "tool_calls") -> Any:
    call = NS(id="call_1", function=NS(name="record_meter", arguments=args))
    return NS(choices=[NS(message=NS(content=None, tool_calls=[call]), finish_reason=finish)])


class FakeOpenAI:
    def __init__(self, result: Any = None, error: Exception | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result, self.error = result, error
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture(autouse=True)
def _settings() -> Any:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_forced_tool_call_with_an_image_round_trips() -> None:
    fake = FakeOpenAI(completion(json.dumps({"reading": 1234.5})))
    image = {"image": {"format": "jpeg", "source": {"bytes": b"\xff\xd8jpeg"}}}
    res = ai.OpenAIConverse(fake, "gemini-x").converse(**converse_request(image))

    req = fake.calls[0]
    assert req["model"] == "gemini-x"  # the Bedrock model id is not sent
    assert req["messages"][0] == {"role": "system", "content": "Be careful."}
    img, text = req["messages"][1]["content"]
    assert img["image_url"]["url"].startswith("data:image/jpeg;base64,/9hq")
    assert text == {"type": "text", "text": "Read the meter."}
    assert req["tools"][0]["function"]["name"] == "record_meter"
    assert req["tools"][0]["function"]["parameters"] == SCHEMA
    assert req["tool_choice"] == {"type": "function", "function": {"name": "record_meter"}}
    assert req["temperature"] == 0 and req["max_tokens"] >= 300

    assert res["stopReason"] == "tool_use"
    [part] = res["output"]["message"]["content"]
    assert part["toolUse"]["name"] == "record_meter"
    assert part["toolUse"]["input"] == {"reading": 1234.5}


def test_bad_tool_arguments_are_dropped_and_retried_once() -> None:
    fake = FakeOpenAI(completion("not json", finish="stop"))
    res = ai.OpenAIConverse(fake, "m").converse(**converse_request({"text": "hi"}))
    assert res["output"]["message"]["content"] == []
    assert len(fake.calls) == 2


def test_pdf_goes_to_manual_entry_without_calling_the_model() -> None:
    fake = FakeOpenAI()
    pdf = {"document": {"format": "pdf", "name": "bill", "source": {"bytes": b"%PDF"}}}
    with pytest.raises(ai.AiUnavailable) as err:
        ai.OpenAIConverse(fake, "m").converse(**converse_request(pdf))
    assert fake.calls == []
    assert extraction.ai_unavailable(err.value)


@pytest.mark.parametrize("name", ["AuthenticationError", "RateLimitError", "PermissionDeniedError"])
def test_key_and_quota_errors_mean_unavailable(name: str) -> None:
    fake = FakeOpenAI(error=type(name, (Exception,), {})("quota exceeded"))
    with pytest.raises(ai.AiUnavailable) as err:
        ai.OpenAIConverse(fake, "m").converse(**converse_request({"text": "hi"}))
    assert extraction.ai_unavailable(err.value)


def test_other_errors_are_not_unavailable() -> None:
    fake = FakeOpenAI(error=ValueError("bad gateway"))
    with pytest.raises(ValueError) as err:
        ai.OpenAIConverse(fake, "m").converse(**converse_request({"text": "hi"}))
    assert not extraction.ai_unavailable(err.value)


def test_provider_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    ai._openai_converse.cache_clear()
    ai.api_key.cache_clear()
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setenv("AI_MODEL", "gemini-test")
    client = extraction.bedrock()
    assert isinstance(client, ai.OpenAIConverse) and client.model == "gemini-test"
    ai._openai_converse.cache_clear()
    ai.api_key.cache_clear()


def test_missing_key_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    ai.api_key.cache_clear()
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_KEY_PARAM", "")
    monkeypatch.setenv("AI_API_KEY", "")
    with pytest.raises(ai.AiUnavailable):
        ai.api_key()
    ai.api_key.cache_clear()


def test_out_of_quota_model_falls_back_to_the_next() -> None:
    class Quota(FakeOpenAI):
        def create(self, **kw: Any) -> Any:
            self.calls.append(kw)
            if kw["model"] == "main":
                raise type("RateLimitError", (Exception,), {})("quota")
            return completion(json.dumps({"reading": 5}))

    fake = Quota()
    res = ai.OpenAIConverse(fake, "main", ("backup",)).converse(**converse_request({"text": "hi"}))
    assert [c["model"] for c in fake.calls] == ["main", "backup"]
    assert res["output"]["message"]["content"][0]["toolUse"]["input"] == {"reading": 5}


def test_every_model_out_of_quota_is_unavailable() -> None:
    fake = FakeOpenAI(error=type("RateLimitError", (Exception,), {})("quota"))
    with pytest.raises(ai.AiUnavailable):
        ai.OpenAIConverse(fake, "a", ("b",)).converse(**converse_request({"text": "hi"}))
    assert [c["model"] for c in fake.calls] == ["a", "b"]


def test_identical_request_is_answered_from_the_cache(
    aws: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AI_CACHE", "true")
    get_settings.cache_clear()
    fake = FakeOpenAI(completion(json.dumps({"reading": 7})))
    client = ai.OpenAIConverse(fake, "m")
    image = {"image": {"format": "jpeg", "source": {"bytes": b"same-photo"}}}
    first = client.converse(**converse_request(image))
    second = client.converse(**converse_request(image))
    assert first == second and len(fake.calls) == 1
    other = {"image": {"format": "jpeg", "source": {"bytes": b"another-photo"}}}
    client.converse(**converse_request(other))
    assert len(fake.calls) == 2


def test_groq_is_tried_after_every_gemini_model_is_out_of_quota() -> None:
    gemini = FakeOpenAI(error=type("RateLimitError", (Exception,), {})("quota"))
    groq = FakeOpenAI(completion(json.dumps({"reading": 9})))
    client = ai.OpenAIConverse(gemini, "g1", ("g2",), extra=((groq, "llama"),))
    res = client.converse(**converse_request({"text": "hi"}))
    assert [c["model"] for c in gemini.calls] == ["g1", "g2"]
    assert [c["model"] for c in groq.calls] == ["llama"]
    assert res["model"] == "llama"
    assert res["output"]["message"]["content"][0]["toolUse"]["input"] == {"reading": 9}


def test_groq_first_reader_uses_gemini_only_as_backup() -> None:
    gemini = FakeOpenAI(completion(json.dumps({"reading": 1})))
    groq = FakeOpenAI(error=type("RateLimitError", (Exception,), {})("quota"))
    client = ai.OpenAIConverse(groq, "llama", (), extra=((gemini, "g1"),))
    res = client.converse(**converse_request({"text": "hi"}))
    assert [c["model"] for c in groq.calls] == ["llama"]
    assert [c["model"] for c in gemini.calls] == ["g1"]
    assert res["model"] == "g1"


def test_second_opinion_is_the_same_reader_when_groq_is_not_set_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    sentinel = object()
    monkeypatch.setattr(extraction, "bedrock", lambda: sentinel)
    assert extraction.second_opinion() is sentinel


def test_groq_key_comes_from_the_environment_or_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ai.groq_key.cache_clear()
    monkeypatch.setenv("AI_GROQ_API_KEY", "")
    monkeypatch.setenv("AI_GROQ_KEY_PARAM", "")
    get_settings.cache_clear()
    assert not ai.groq_configured()
    with pytest.raises(ai.AiUnavailable):
        ai.groq_key()
    monkeypatch.setenv("AI_GROQ_API_KEY", "k")
    get_settings.cache_clear()
    ai.groq_key.cache_clear()
    assert ai.groq_configured() and ai.groq_key() == "k"
    ai.groq_key.cache_clear()
