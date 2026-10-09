"""Waste maths: indicative scrap value and CO₂ avoided, with working.

Values come only from data/waste.json (sourced rates and EPA WARM factors).
"""

import json
from functools import cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.calc.working import Source, WorkingStep

DATA = Path(__file__).parent.parent / "data" / "waste.json"
Stream = Literal["wet", "dry", "sanitary", "special_care", "e_waste"]
Size = Literal["handful", "bag", "sack"]


@cache
def data() -> dict[str, Any]:
    return json.loads(DATA.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


def materials() -> dict[str, dict[str, Any]]:
    return {m["id"]: m for m in data()["materials"]}


def preset_kg(size: Size) -> float:
    return float(data()["size_presets_kg"][size])


class Item(BaseModel):
    material: str
    kg: float = Field(gt=0, le=1000)


class ItemValue(BaseModel):
    material: str
    label: str
    stream: Stream
    kg: float
    inr_min: float | None
    inr_max: float | None
    co2_kg: float | None


class ScanValue(BaseModel):
    items: list[ItemValue]
    kg_total: float
    kg_diverted: float  # recyclable or compostable, i.e. kept out of landfill if handed over right
    inr_min: float
    inr_max: float
    co2_t: float
    working: list[WorkingStep]


def value_scan(items: list[Item]) -> ScanValue:
    mats = materials()
    out: list[ItemValue] = []
    for it in items:
        m = mats.get(it.material)
        if m is None:
            raise ValueError(f"unknown material: {it.material}")
        rate = m["rate_inr_per_kg"]
        co2 = m["co2"]
        out.append(
            ItemValue(
                material=it.material,
                label=m["label"],
                stream=m["stream"],
                kg=it.kg,
                inr_min=None if rate is None else round(rate["min"] * it.kg, 2),
                inr_max=None if rate is None else round(rate["max"] * it.kg, 2),
                co2_kg=None if co2 is None else round(co2["kg_co2e_avoided_per_kg"] * it.kg, 3),
            )
        )
    d = data()
    inr_min = sum(i.inr_min or 0 for i in out)
    inr_max = sum(i.inr_max or 0 for i in out)
    co2_t = sum(i.co2_kg or 0 for i in out) / 1000
    diverted = sum(i.kg for i in out if mats[i.material]["recyclable"] or i.material == "wet")
    working = [
        WorkingStep(
            id="scrap_value",
            label="What your dry waste is worth",
            formula="Σ weight × (lowest to highest price per kg for that material)",
            inputs={f"{i.label} (kg)": i.kg for i in out if i.inr_max is not None},
            result=f"{inr_min:.0f}–{inr_max:.0f}",
            unit="₹, indicative",
            source=Source(
                name=d["rates_source"],
                url="https://www.thekabadiwala.com/scrap-rates/Pune",
                as_of=d["rates_as_of"],
                status="estimate",
            ),
        ),
        WorkingStep(
            id="waste_co2",
            label="CO₂ avoided by recycling or composting",
            formula="Σ weight × kg CO₂e avoided per kg "
            "(recycling or composting instead of landfill)",
            inputs={f"{i.label} (kg)": i.kg for i in out if i.co2_kg is not None},
            result=round(co2_t, 4),
            unit="t CO₂e",
            source=Source(
                name=d["co2_source"], url=d["co2_source_url"], as_of="2023-12-01", status="estimate"
            ),
        ),
    ]
    return ScanValue(
        items=out,
        kg_total=round(sum(i.kg for i in out), 3),
        kg_diverted=round(diverted, 3),
        inr_min=round(inr_min, 0),
        inr_max=round(inr_max, 0),
        co2_t=round(co2_t, 4),
        working=working,
    )
