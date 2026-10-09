"""A scripted stand-in for the Bedrock model, for tests and offline development.

Each call to `stream` asks a `respond` function for the next turn, given the
conversation so far, and replays it as Bedrock ConverseStream events: either
text (streamed in small chunks) or one or more tool calls.
"""

import json
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import Any

from strands.models import Model


@dataclass
class Turn:
    text: str = ""
    tool_calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)


Respond = Callable[[list[dict[str, Any]], str | None, list[str]], Turn]


class ScriptedModel(Model):
    def __init__(self, respond: Respond) -> None:
        self.respond = respond
        self.calls: list[dict[str, Any]] = []

    def update_config(self, **model_config: Any) -> None:
        pass

    def get_config(self) -> dict[str, Any]:
        return {}

    async def structured_output(self, *args: Any, **kwargs: Any) -> AsyncGenerator[Any, None]:
        raise NotImplementedError
        yield  # pragma: no cover

    async def stream(  # type: ignore[override]
        self,
        messages: list[dict[str, Any]],
        tool_specs: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[dict[str, Any], None]:
        tools = [t["name"] for t in tool_specs or []]
        self.calls.append({"system_prompt": system_prompt, "tools": tools, "messages": messages})
        turn = self.respond(messages, system_prompt, tools)
        yield {"messageStart": {"role": "assistant"}}
        if turn.text:
            yield {"contentBlockStart": {"start": {}}}
            for i in range(0, len(turn.text), 12):
                yield {"contentBlockDelta": {"delta": {"text": turn.text[i : i + 12]}}}
            yield {"contentBlockStop": {}}
        for n, (name, args) in enumerate(turn.tool_calls):
            yield {
                "contentBlockStart": {
                    "start": {"toolUse": {"toolUseId": f"t{n}-{name}", "name": name}}
                }
            }
            yield {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(args)}}}}
            yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "tool_use" if turn.tool_calls else "end_turn"}}
