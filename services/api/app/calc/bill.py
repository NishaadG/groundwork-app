"""From one bill to a year of monthly use.

Irradiance is by calendar month (Jan..Dec), so consumption must be too. We use, in
order of preference: the bill's own month-by-month history, then the billed units
normalised to a 30.4-day month. Months we have no data for take the average of the
months we do, and the working trace says how many months were real.
"""

from datetime import date

from pydantic import BaseModel, Field

from app.calc.working import WorkingStep

AVG_MONTH_DAYS = 365 / 12


class HistoryPoint(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")  # YYYY-MM
    units: float = Field(ge=0, le=20_000)


class MonthlyProfile(BaseModel):
    monthly_units: list[float]  # Jan..Dec
    months_from_data: int
    working: WorkingStep


def _month_index(month: str) -> int:
    return int(month[5:7]) - 1


def monthly_profile(
    units: float,
    period_start: date | None,
    period_end: date | None,
    history: list[HistoryPoint] | None = None,
) -> MonthlyProfile:
    if units < 0:
        raise ValueError("units must be >= 0")

    # Billing periods are printed inclusive ("01-06-2026 to 31-07-2026" is 61 days)
    days = (period_end - period_start).days + 1 if period_start and period_end else None
    per_month = units * AVG_MONTH_DAYS / days if days and days > 0 else units

    # Latest reading per calendar month wins (history can span more than 12 months)
    known: dict[int, float] = {}
    for point in sorted(history or [], key=lambda p: p.month):
        known[_month_index(point.month)] = point.units
    if period_end is not None:
        known[period_end.month - 1] = round(per_month, 2)

    if known:
        fill = sum(known.values()) / len(known)
        monthly = [round(known.get(m, fill), 2) for m in range(12)]
    else:
        monthly = [round(per_month, 2)] * 12

    n = len(known) if known else 0
    working = WorkingStep(
        id="consumption",
        label="Your electricity use, month by month",
        formula=(
            "Months shown on your bill are used as they are; the billed units are scaled to "
            "an average 30.4-day month; months with no data take the average of the rest"
        ),
        inputs={
            "billed_units_kwh": units,
            "billing_days": days,
            "months_with_data": n,
            "yearly_units_kwh": round(sum(monthly), 1),
        },
        result=monthly,
        unit="kWh per month, Jan–Dec",
    )
    return MonthlyProfile(monthly_units=monthly, months_from_data=n, working=working)
