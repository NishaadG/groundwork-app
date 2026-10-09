"""The `working` trace every calc function returns.

The "How we calculated this" drawer renders these steps directly, so the
explanation can never drift from the maths.
"""

from pydantic import BaseModel

Scalar = float | int | str | None


class Source(BaseModel):
    name: str
    url: str | None = None
    as_of: str | None = None
    status: str | None = None


class WorkingStep(BaseModel):
    id: str
    label: str
    formula: str
    inputs: dict[str, Scalar | list[float]]
    result: Scalar | list[float]
    unit: str = ""
    source: Source | None = None
