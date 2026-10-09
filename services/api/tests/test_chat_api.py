import io
import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.agents import copilot
from app.agents.guard import numbers_in, untraced_numbers
from app.agents.scripted import ScriptedModel, Turn
from app.config import get_settings
from app.services import chat, extraction
from tests.conftest import MintToken

Script = Callable[[list[dict[str, Any]], str | None, list[str]], Turn]


def h(mint: MintToken, sub: str = "chitra") -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(sub)}"}


def events(text: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def last_tool_result(messages: list[dict[str, Any]]) -> Any:
    last = messages[-1]
    for c in last["content"]:
        if "toolResult" in c:
            content = c["toolResult"]["content"][0]
            return content.get("json") or json.loads(content.get("text", "null"))
    return None


def specialist(
    tool_name: str, reply: Callable[[Any], str], args: dict[str, Any] | None = None
) -> Script:
    """Calls one tool, then answers from its result."""

    def respond(messages: list[dict[str, Any]], _sp: str | None, _tools: list[str]) -> Turn:
        result = last_tool_result(messages)
        if result is None:
            return Turn(tool_calls=[(tool_name, args or {})])
        return Turn(text=reply(result))

    return respond


def route_to(name: str, final: Callable[[Any], str] | None = None) -> Script:
    def respond(messages: list[dict[str, Any]], _sp: str | None, _tools: list[str]) -> Turn:
        result = last_tool_result(messages)
        if result is None:
            return Turn(tool_calls=[(name, {"input": "the user's question"})])
        return Turn(text=final(result) if final else "done")

    return respond


class Models:
    """The scripted models the copilot builds, by role, and the scripts they follow."""

    def __init__(self) -> None:
        self.made: dict[str, ScriptedModel] = {}
        noop: Script = lambda m, s, t: Turn(text="unused")  # noqa: E731
        self.scripts: dict[str, Script] = dict.fromkeys(
            ("orchestrator", "solar", "water", "waste"), noop
        )

    def __getitem__(self, role: str) -> ScriptedModel:
        return self.made[role]


@pytest.fixture
def models(monkeypatch: pytest.MonkeyPatch) -> Models:
    m = Models()

    def model_for(role: copilot.Role) -> ScriptedModel:
        m.made[role] = ScriptedModel(m.scripts[role])
        return m.made[role]

    monkeypatch.setattr(chat, "model_for", model_for)
    return m


def set_scripts(models: Models, **scripts: Script) -> None:
    models.scripts.update(scripts)


def test_water_question_routes_to_water_agent_with_a_card(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    set_scripts(
        models,
        orchestrator=route_to("water_agent"),
        water=specialist(
            "get_water_summary",
            lambda r: "No readings yet." if not r["has_readings"] else f"{r['litres_per_day']} L",
        ),
    )
    r = client.post(
        "/v1/chat", headers=h(mint_token), json={"message": "How much water do we use?"}
    )
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = events(r.text)
    kinds = [e for e, _ in ev]
    assert ("tool_start", {"name": "water_agent"}) in ev
    assert ("tool_start", {"name": "get_water_summary"}) in ev
    assert (
        "card",
        {
            "type": "water_summary",
            "data": {
                "litres_per_day": None,
                "lpcd": None,
                "benchmark_lpcd": None,
                "fixed_leaks": 0,
            },
        },
    ) in ev
    assert "".join(d["text"] for e, d in ev if e == "token") == "No readings yet."
    assert kinds[-1] == "done" and ev[-1][1]["agents"] == ["water_agent"]
    # The specialist's answer is the reply: no second orchestrator call
    assert len(models["orchestrator"].calls) == 1


def test_ledger_question_uses_this_users_data_only(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    # Another household has logged waste; this one has nothing
    client.post(
        "/v1/waste/scans",
        headers=h(mint_token, "neighbour"),
        json={"items": [{"material": "newspaper", "kg": 9}]},
    )
    client.post(
        "/v1/waste/scans", headers=h(mint_token), json={"items": [{"material": "pet", "kg": 2}]}
    )

    def orch(messages: list[dict[str, Any]], _sp: str | None, _t: list[str]) -> Turn:
        result = last_tool_result(messages)
        if result is None:
            return Turn(tool_calls=[("get_ledger", {})])
        return Turn(text=f"You've kept {result['realised']['kg']:g} kg out of landfill.")

    set_scripts(models, orchestrator=orch)
    ev = events(
        client.post(
            "/v1/chat", headers=h(mint_token), json={"message": "How much have I saved?"}
        ).text
    )
    reply = "".join(d["text"] for e, d in ev if e == "token")
    assert reply == "You've kept 2 kg out of landfill."
    card = next(d for e, d in ev if e == "card")
    assert card["type"] == "ledger_snapshot" and card["data"]["realised"]["kg"] == 2


def test_waste_photo_is_classified_in_chat(
    client: TestClient,
    mint_token: MintToken,
    models: Models,
    aws: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buf, format="JPEG")
    key = "uploads/chitra/waste/p.jpg"
    aws["s3"].put_object(Bucket="groundwork-uploads-test", Key=key, Body=buf.getvalue())

    class Vision:
        def converse(self, **_: Any) -> dict[str, Any]:
            out = {
                "items": [
                    {
                        "label": "Bottles",
                        "material": "pet",
                        "tip": "Rinse them.",
                        "confidence": "high",
                    }
                ]
            }
            return {"output": {"message": {"content": [{"toolUse": {"input": out}}]}}}

    monkeypatch.setattr(extraction, "bedrock", lambda: Vision())
    set_scripts(
        models,
        orchestrator=route_to("waste_agent"),
        waste=specialist("classify_attached_photo", lambda r: f"I see {r['items'][0]['label']}."),
    )
    body = {"message": "What is this?", "attachment": {"kind": "waste", "s3_key": key}}
    ev = events(client.post("/v1/chat", headers=h(mint_token), json=body).text)
    card = next(d for e, d in ev if e == "card")
    assert card["type"] == "waste_items" and card["data"]["items"][0]["stream"] == "dry"
    # The model is told a photo is attached; it never sees the storage key
    first = models["orchestrator"].calls[0]["messages"][0]["content"][0]["text"]
    assert first.startswith("[The user attached a waste photo.]") and key not in first


def test_someone_elses_upload_is_refused_before_streaming(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    set_scripts(models)
    body = {
        "message": "Read this",
        "attachment": {"kind": "bill", "s3_key": "uploads/other/bill/x.jpg"},
    }
    r = client.post("/v1/chat", headers=h(mint_token), json=body)
    assert r.status_code == 404 and r.json()["error"]["code"] == "upload_not_found"


def test_history_is_kept_per_session_and_language_follows_profile(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    client.put("/v1/me", headers=h(mint_token), json={"lang": "hi"})
    set_scripts(models, orchestrator=lambda m, s, t: Turn(text="नमस्ते"))
    first = events(client.post("/v1/chat", headers=h(mint_token), json={"message": "Hello"}).text)
    sid = first[-1][1]["session_id"]
    assert "Hindi" in (models["orchestrator"].calls[0]["system_prompt"] or "")

    client.post("/v1/chat", headers=h(mint_token), json={"session_id": sid, "message": "Again"})
    msgs = models["orchestrator"].calls[0]["messages"]
    assert [m["content"][0]["text"] for m in msgs[:2]] == ["Hello", "नमस्ते"]

    turns = client.get(f"/v1/chat/{sid}", headers=h(mint_token)).json()["data"]["turns"]
    assert [t["role"] for t in turns] == ["user", "assistant", "user", "assistant"]
    # Another user can't read it
    assert client.get(f"/v1/chat/{sid}", headers=h(mint_token, "x")).json()["data"]["turns"] == []


def test_rate_limit(
    client: TestClient, mint_token: MintToken, models: Models, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "ai_calls_per_hour", 1)
    set_scripts(models, orchestrator=lambda m, s, t: Turn(text="ok"))
    assert client.post("/v1/chat", headers=h(mint_token), json={"message": "a"}).status_code == 200
    r = client.post("/v1/chat", headers=h(mint_token), json={"message": "b"})
    assert r.status_code == 429


def test_model_failure_becomes_an_error_event(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    def boom(m: Any, s: Any, t: Any) -> Turn:
        raise RuntimeError("bedrock down")

    set_scripts(models, orchestrator=boom)
    ev = events(client.post("/v1/chat", headers=h(mint_token), json={"message": "hi"}).text)
    assert ev[-1] == (
        "error",
        {"code": "copilot_failed", "message": "Something went wrong. Try again."},
    )


# ---- number tracing ----


def test_numbers_in_handles_indian_grouping_and_devanagari() -> None:
    assert numbers_in("₹1,23,456 and ३२० litres, 4.5 kW") == [123456, 320, 4.5]


@pytest.mark.parametrize(
    ("reply", "untraced"),
    [
        ("You use about 512 litres a day.", []),
        ("That's 512.4 L.", []),
        ("You'd save ₹34,568 in year one.", []),  # rounded from 34567.8
        ("About 420 kg of CO₂.", []),  # 0.42 t
        ("You'd save ₹40,000 a year.", [40000]),
        ("Step 1: check the toilet. Step 2: taps.", []),
    ],
)
def test_untraced_numbers(reply: str, untraced: list[float]) -> None:
    tools = [{"litres_per_day": 512.4, "savings_year1_inr": 34567.8, "co2_t": 0.42}]
    assert untraced_numbers(reply, tools) == untraced


@pytest.fixture(autouse=True)
def _model_reachable() -> None:
    chat._model_down_until = 0.0


def test_unreachable_model_falls_back_to_rule_based_answers(
    client: TestClient, mint_token: MintToken, models: Models
) -> None:
    def refused(m: Any, s: Any, t: Any) -> Turn:
        raise RuntimeError("ValidationException: ConverseStream: Operation not allowed")

    set_scripts(models, orchestrator=refused)
    hh = h(mint_token)
    client.post("/v1/waste/scans", headers=hh, json={"items": [{"material": "newspaper", "kg": 5}]})
    ev = events(
        client.post("/v1/chat", headers=hh, json={"message": "How much have I saved?"}).text
    )
    assert ev[-1][0] == "done" and not any(e == "error" for e, _ in ev)
    reply = "".join(d["text"] for e, d in ev if e == "token")
    assert "5.0 kg of waste kept out of landfill" in reply
    assert any(e == "card" and d["type"] == "ledger_snapshot" for e, d in ev)
    # The next question skips the model and answers straight away
    calls = len(models["orchestrator"].calls)
    ev2 = events(
        client.post(
            "/v1/chat", headers=hh, json={"message": "Can I recycle a greasy pizza box?"}
        ).text
    )
    assert "wet waste" in "".join(d["text"] for e, d in ev2 if e == "token")
    assert len(models["orchestrator"].calls) == calls


def test_rule_based_answers_cover_each_topic(client: TestClient, mint_token: MintToken) -> None:
    from app.agents import rules

    client.post("/v1/me", headers=h(mint_token), json={})
    assert "Solar page" in rules.answer("chitra", "Is solar worth it?").text
    assert "late at night" in rules.answer("chitra", "Do I have a leak?").text.lower()
    news = rules.answer("chitra", "What does a kabadiwala pay for newspaper?").text
    assert "₹11–12 a kg" in news and "dry waste" in news
    assert "multilayer" in rules.answer("chitra", "चिप्स का पैकेट किस कचरे में जाता है?").text.lower()
    assert rules.answer("chitra", "Write me a poem").text == rules.HELP


def test_ai_unavailable_detection() -> None:
    from app.services.extraction import ai_unavailable

    try:
        try:
            raise RuntimeError("An error occurred (ValidationException): Operation not allowed")
        except RuntimeError as inner:
            raise ValueError("wrapped") from inner
    except ValueError as outer:
        assert ai_unavailable(outer)
    assert not ai_unavailable(RuntimeError("Read timed out"))
