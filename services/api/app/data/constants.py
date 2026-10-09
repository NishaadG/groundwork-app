"""Typed access to constants.json (the single source for every constant)."""

import json
from functools import cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.calc.working import Source

DATA_DIR = Path(__file__).parent


class Constant(BaseModel):
    label: str
    value: Any
    unit: str
    source: str
    source_url: str | None
    as_of: str
    status: str

    def as_source(self) -> Source:
        return Source(name=self.source, url=self.source_url, as_of=self.as_of, status=self.status)


@cache
def constants() -> dict[str, Constant]:
    raw = json.loads((DATA_DIR / "constants.json").read_text(encoding="utf-8"))
    return {key: Constant.model_validate(c) for key, c in raw["constants"].items()}


def get(key: str) -> Constant:
    return constants()[key]
