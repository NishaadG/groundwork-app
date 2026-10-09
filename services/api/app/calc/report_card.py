"""Monthly report card: a grade per resource against the user's OWN
baseline, never against other homes. Pure and traced like every calc."""

from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.calc.working import WorkingStep

Grade = Literal["A", "B", "C", "D", "E"]

# Change vs your own baseline → grade. Lower use is better.
BANDS: list[tuple[float, Grade]] = [(-15, "A"), (-5, "B"), (5, "C"), (15, "D")]


class BillPoint(BaseModel):
    units: float
    period_start: date | None
    period_end: date | None


class Card(BaseModel):
    grade: Grade
    change_pct: float
    latest_per_day: float
    baseline_per_day: float
    bills_in_baseline: int
    working: WorkingStep


def grade_for(change_pct: float) -> Grade:
    for limit, grade in BANDS:
        if change_pct <= limit:
            return grade
    return "E"


def per_day(b: BillPoint) -> float | None:
    if b.period_start and b.period_end:
        days = (b.period_end - b.period_start).days + 1
        if days > 0:
            return b.units / days
    return None


def electricity_card(bills: list[BillPoint]) -> Card | None:
    """Latest bill vs the average of up to six earlier bills, per day of use.
    Needs at least two bills with billing periods; otherwise there is no baseline yet."""
    dated = sorted(
        (b for b in bills if per_day(b) is not None), key=lambda b: b.period_end or date.min
    )
    if len(dated) < 2:
        return None
    latest = dated[-1]
    earlier = dated[-7:-1]
    latest_pd = per_day(latest) or 0.0
    base_pd = sum(per_day(b) or 0.0 for b in earlier) / len(earlier)
    if base_pd <= 0:
        return None
    change = (latest_pd - base_pd) / base_pd * 100
    grade = grade_for(change)
    return Card(
        grade=grade,
        change_pct=round(change, 1),
        latest_per_day=round(latest_pd, 2),
        baseline_per_day=round(base_pd, 2),
        bills_in_baseline=len(earlier),
        working=WorkingStep(
            id="report_card_energy",
            label="Your electricity grade",
            formula=(
                "change = (units a day on your latest bill − your average units a day on "
                "earlier bills) ÷ that average. A: 15% or more lower; B: 5–15% lower; "
                "C: within 5%; D: 5–15% higher; E: more than 15% higher"
            ),
            inputs={
                "latest_units_per_day": round(latest_pd, 2),
                "baseline_units_per_day": round(base_pd, 2),
                "earlier_bills": len(earlier),
                "change_pct": round(change, 1),
            },
            result=grade,
        ),
    )
