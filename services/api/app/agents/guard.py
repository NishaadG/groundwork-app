"""Checks that every number in a copilot reply traces to a tool result or the user's
own message ("never state a number that didn't come from a tool")."""

import json
import re
from typing import Any

DEVANAGARI = str.maketrans("०१२३४५६७८९", "0123456789")
NUMBER = re.compile(r"(?<![\w.])\d[\d,]*(?:\.\d+)?")


def numbers_in(text: str) -> list[float]:
    out = []
    for m in NUMBER.findall(text.translate(DEVANAGARI)):
        try:
            out.append(float(m.replace(",", "")))
        except ValueError:
            continue
    return out


def _flatten(value: Any) -> list[float]:
    if isinstance(value, bool) or value is None:
        return []
    if isinstance(value, int | float):
        return [float(value)]
    if isinstance(value, str):
        return numbers_in(value)
    if isinstance(value, dict):
        return [n for v in value.values() for n in _flatten(v)]
    if isinstance(value, list | tuple):
        return [n for v in value for n in _flatten(v)]
    return numbers_in(json.dumps(value, default=str))


def _matches(n: float, known: float) -> bool:
    """Same value, allowing the rounding and unit changes a reply naturally makes
    (₹1,234.56 → ₹1,235; 0.42 t → 420 kg; 0.25 → 25%)."""
    for scale in (1, 1000, 0.001, 100):
        k = known * scale
        if any(round(k, d) == round(n, d) for d in (0, 1, 2)) or abs(k - n) <= max(
            0.5, abs(k) * 0.005
        ):
            return True
    return False


def untraced_numbers(reply: str, tool_results: list[Any], user_message: str = "") -> list[float]:
    """Numbers in the reply that appear in no tool result and not in the user's message.
    Small counting numbers (0–10, list markers and the like) are ignored."""
    known = _flatten(tool_results) + numbers_in(user_message)
    return [n for n in numbers_in(reply) if n > 10 and not any(_matches(n, k) for k in known)]
