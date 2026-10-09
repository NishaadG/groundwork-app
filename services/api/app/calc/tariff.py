"""Tariff and bill analysis. Pure functions over data/tariffs/*.json.

A tariff has three kinds of charges:
- regulated charges from the tariff order (slabs, wheeling, fixed, per-unit adders),
- `bill_inputs`: charges that change month to month (FAC, PPAC, tax on sale). The
  value printed on the user's bill overrides the default, which is 0 unless sourced,
- `percent_charges`: duties, taxes and surcharges as a % of named components.
"""

from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, model_validator

from app.calc.working import Source, WorkingStep

TARIFF_DIR = Path(__file__).parent.parent / "data" / "tariffs"

Supply = Literal["single", "three"]
BASE_COMPONENTS = ("fixed", "energy", "wheeling", "adders")


class Slab(BaseModel):
    upto_units: float | None
    energy_inr_per_kwh: float


class UnitsTier(BaseModel):
    upto_units: float | None
    inr: float


class LoadBand(BaseModel):
    upto_kw: float | None
    inr_per_kw: float


class ExtraAboveKw(BaseModel):
    """e.g. ₹250 per 10 kW (or part) above 10 kW."""

    above_kw: float
    block_kw: float
    inr_per_block: float


class FixedCharge(BaseModel):
    mode: Literal["per_connection", "by_units", "per_kw", "per_kw_by_load_band"]
    single_phase_inr: float = 0
    three_phase_inr: float | None = None
    tiers: list[UnitsTier] = []
    inr_per_kw: float = 0
    min_kw: float = 1
    bands: list[LoadBand] = []
    extra_above_kw: ExtraAboveKw | None = None


class PerKwhAdder(BaseModel):
    id: str
    label: str
    inr_per_kwh: float
    source_url: str | None = None


class BillInput(BaseModel):
    id: str
    label: str
    kind: Literal["per_kwh", "pct"]
    base: list[str] = []
    default: float = 0
    note: str = ""


class PercentCharge(BaseModel):
    id: str
    label: str
    pct: float
    base: list[str]
    source_url: str | None = None


class NetMetering(BaseModel):
    allowed: bool
    max_kw_rule: str
    surplus: Literal["banked_annual_settlement", "monthly_settlement"]
    note: str = ""


class CommonArea(BaseModel):
    """Which tariff a housing society's common-area meter is on, and where that's set."""

    note: str
    source: str
    source_url: str


class Tariff(BaseModel):
    id: str
    discom: str
    name: str
    state: str
    category: str
    fy: str
    effective_from: str
    effective_to: str
    source: str
    source_url: str
    billing_cycle_days: int
    slab_mode: Literal["telescopic", "whole_bill"]
    slabs: list[Slab]
    wheeling_inr_per_kwh: float = 0
    fixed_charge: FixedCharge
    per_kwh_adders: list[PerKwhAdder] = []
    bill_inputs: list[BillInput] = []
    percent_charges: list[PercentCharge] = []
    notes: list[str] = []
    net_metering: NetMetering
    common_area: CommonArea | None = None

    @model_validator(mode="after")
    def _check(self) -> "Tariff":
        if not self.slabs or self.slabs[-1].upto_units is not None:
            raise ValueError("slabs must end with an open slab (upto_units: null)")
        known = set(BASE_COMPONENTS)
        for bi in self.bill_inputs:
            unknown = set(bi.base) - known
            if unknown:
                raise ValueError(f"bill input {bi.id}: unknown base {unknown}")
            known.add(bi.id)
        for pc in self.percent_charges:
            unknown = set(pc.base) - known
            if unknown:
                raise ValueError(f"percent charge {pc.id}: unknown base {unknown}")
            known.add(pc.id)
        return self

    def as_source(self) -> Source:
        return Source(
            name=self.source, url=self.source_url, as_of=self.effective_from, status="verified"
        )


@cache
def load_tariff(tariff_id: str) -> Tariff:
    path = TARIFF_DIR / f"{tariff_id}.json"
    if not path.is_file():
        raise KeyError(f"Unknown tariff: {tariff_id}")
    return Tariff.model_validate_json(path.read_text(encoding="utf-8"))


def available_tariffs() -> list[str]:
    return sorted(p.stem for p in TARIFF_DIR.glob("*.json"))


class BillContext(BaseModel):
    """Connection details and month-to-month charges read from the user's bill."""

    supply: Supply = "single"
    load_kw: float = 1.0
    inputs: dict[str, float] = {}


class SlabLine(BaseModel):
    from_units: float
    to_units: float | None
    units: float
    rate: float
    amount: float


class BillBreakdown(BaseModel):
    units: float
    slabs: list[SlabLine]
    charges: dict[str, float]
    total: float

    @property
    def fixed(self) -> float:
        return self.charges["fixed"]

    @property
    def energy(self) -> float:
        return self.charges["energy"]


def _slab_lines(units: float, tariff: Tariff) -> list[SlabLine]:
    if tariff.slab_mode == "whole_bill":
        # Every unit is charged at the rate of the slab the total falls into.
        slab = next(s for s in tariff.slabs if s.upto_units is None or units <= s.upto_units)
        rate = slab.energy_inr_per_kwh
        line = SlabLine(
            from_units=0, to_units=slab.upto_units, units=units, rate=rate, amount=units * rate
        )
        return [line]

    lines: list[SlabLine] = []
    lower = 0.0
    for slab in tariff.slabs:
        upper = slab.upto_units
        in_slab = max(0.0, (units if upper is None else min(units, upper)) - lower)
        if in_slab > 0:
            lines.append(
                SlabLine(
                    from_units=lower,
                    to_units=upper,
                    units=in_slab,
                    rate=slab.energy_inr_per_kwh,
                    amount=in_slab * slab.energy_inr_per_kwh,
                )
            )
        if upper is None or units <= upper:
            break
        lower = upper
    return lines


def fixed_charge(units: float, tariff: Tariff, ctx: BillContext) -> float:
    fc = tariff.fixed_charge
    if fc.mode == "per_kw":
        amount = fc.inr_per_kw * max(ctx.load_kw, fc.min_kw)
    elif fc.mode == "per_kw_by_load_band":
        band = next(b for b in fc.bands if b.upto_kw is None or ctx.load_kw <= b.upto_kw)
        amount = band.inr_per_kw * max(ctx.load_kw, fc.min_kw)
    elif ctx.supply == "three" and fc.three_phase_inr is not None:
        amount = fc.three_phase_inr
    elif fc.mode == "by_units":
        tier = next(t for t in fc.tiers if t.upto_units is None or units <= t.upto_units)
        amount = tier.inr
    else:
        amount = fc.single_phase_inr

    extra = fc.extra_above_kw
    if extra is not None and ctx.load_kw > extra.above_kw:
        blocks = -(-(ctx.load_kw - extra.above_kw) // extra.block_kw)  # ceil
        amount += blocks * extra.inr_per_block
    return amount


def bill_breakdown(units: float, tariff: Tariff, ctx: BillContext | None = None) -> BillBreakdown:
    """Charges for one billing cycle of `units` kWh."""
    if units < 0:
        raise ValueError("units must be >= 0")
    ctx = ctx or BillContext()

    slabs = _slab_lines(units, tariff)
    charges: dict[str, float] = {
        "fixed": fixed_charge(units, tariff, ctx),
        "energy": sum(s.amount for s in slabs),
        "wheeling": units * tariff.wheeling_inr_per_kwh,
        "adders": units * sum(a.inr_per_kwh for a in tariff.per_kwh_adders),
    }
    for bi in tariff.bill_inputs:
        value = ctx.inputs.get(bi.id, bi.default)
        if bi.kind == "per_kwh":
            charges[bi.id] = units * value
        else:
            charges[bi.id] = sum(charges[c] for c in bi.base) * value / 100
    for pc in tariff.percent_charges:
        charges[pc.id] = sum(charges[c] for c in pc.base) * pc.pct / 100

    return BillBreakdown(units=units, slabs=slabs, charges=charges, total=sum(charges.values()))


def bill_total(units: float, tariff: Tariff, ctx: BillContext | None = None) -> float:
    return bill_breakdown(units, tariff, ctx).total


def marginal_rate(units: float, tariff: Tariff, ctx: BillContext | None = None) -> float:
    """₹ saved by the last kWh not drawn from the grid, all-in (including duty).

    Solar offsets the top slab first, so savings use this rate, not the bill average.
    """
    if units <= 0:
        return 0.0
    step = min(1.0, units)
    return (bill_total(units, tariff, ctx) - bill_total(units - step, tariff, ctx)) / step


class BillCheck(BaseModel):
    computed_total: float
    billed_total: float
    diff_pct: float
    matches: bool
    working: list[WorkingStep]


def check_bill(
    units: float, billed_total: float, tariff: Tariff, ctx: BillContext | None = None
) -> BillCheck:
    """Compare the tariff-computed bill with the amount printed on it (>10% → flag)."""
    b = bill_breakdown(units, tariff, ctx)
    diff = (billed_total - b.total) / b.total * 100 if b.total else 0.0
    step = WorkingStep(
        id="bill_check",
        label="Your bill, recalculated from the tariff",
        formula="fixed + Σ(slab units × rate) + per-unit charges + % duties and surcharges",
        inputs={
            "units_kwh": units,
            **{f"{k}_inr": round(v, 2) for k, v in b.charges.items()},
            "printed_total_inr": billed_total,
        },
        result=round(b.total, 2),
        unit="₹",
        source=tariff.as_source(),
    )
    return BillCheck(
        computed_total=round(b.total, 2),
        billed_total=billed_total,
        diff_pct=round(diff, 1),
        matches=abs(diff) <= 10,
        working=[step],
    )
