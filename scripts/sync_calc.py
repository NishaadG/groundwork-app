"""Sync the canonical calc data to the web app and regenerate shared fixtures.

Python `services/api/app/calc` is canonical. This script:
1. copies constants.json and tariffs/*.json to apps/web/lib/calc/data/
2. writes packages/schemas/fixtures/{tariff,solar}_cases.json from the Python calc

Both the pytest and Vitest suites check these files, so a stale copy fails CI.

Run from the repo root:  services/api/.venv/Scripts/python scripts/sync_calc.py
(add --check to only verify that everything is up to date)
"""

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.calc.solar import SolarInputs, calc_solar  # noqa: E402
from app.calc.tariff import BillContext, available_tariffs, bill_breakdown, load_tariff  # noqa: E402

DATA_SRC = ROOT / "services" / "api" / "app" / "data"
DATA_DST = ROOT / "apps" / "web" / "lib" / "calc" / "data"
FIXTURES = ROOT / "packages" / "schemas" / "fixtures"

# NASA POWER climatology (ALLSKY_SFC_SW_DWN, 2001-2020) for Pune, Bengaluru and Delhi
PUNE_SUN = [4.9891, 5.8502, 6.6137, 7.0778, 7.0174, 4.5682, 3.3101, 3.3838, 4.3092, 5.0119, 4.896, 4.6649]
BENGALURU_SUN = [5.4953, 6.2806, 6.607, 6.5966, 6.222, 5.328, 4.7582, 4.8199, 5.2908, 5.0251, 4.6637, 4.7525]
DELHI_SUN = [3.0898, 4.3471, 5.6489, 6.5806, 6.7116, 6.0862, 5.0071, 4.8852, 5.0578, 4.6646, 3.5796, 3.029]

TARIFF_CASES: list[dict[str, Any]] = [
    {"tariff": t, "units": u, "ctx": ctx}
    for t in ["msedcl", "tata-power-mumbai", "adani-mumbai", "bescom", "bses-rajdhani"]
    for u in [0, 45, 100, 101, 250, 300, 301, 480, 650, 1300]
    for ctx in [
        {"supply": "single", "load_kw": 2, "inputs": {}},
        {"supply": "three", "load_kw": 12, "inputs": {"fac": 0.35, "ppac": 18, "tax_on_sale": 0.2}},
    ]
]

SOLAR_CASES: list[dict[str, Any]] = [
    {"name": "pune_msedcl_typical", "irradiance_kwh_m2_day": PUNE_SUN, "monthly_units": [280.0] * 12,
     "roof_area_sqft": 350, "shading": "none", "sanctioned_load_kw": 3, "tariff": "msedcl"},
    {"name": "pune_msedcl_seasonal_banking", "irradiance_kwh_m2_day": PUNE_SUN,
     "monthly_units": [180, 190, 260, 340, 380, 300, 220, 210, 220, 240, 200, 180],
     "roof_area_sqft": 600, "shading": "partial", "sanctioned_load_kw": 5, "tariff": "msedcl"},
    {"name": "pune_roof_limited", "irradiance_kwh_m2_day": PUNE_SUN, "monthly_units": [520.0] * 12,
     "roof_area_sqft": 220, "shading": "none", "sanctioned_load_kw": 6, "tariff": "msedcl"},
    {"name": "mumbai_tata_load_limited", "irradiance_kwh_m2_day": PUNE_SUN, "monthly_units": [600.0] * 12,
     "roof_area_sqft": 1200, "shading": "heavy", "sanctioned_load_kw": 2, "tariff": "tata-power-mumbai"},
    {"name": "mumbai_adani_override", "irradiance_kwh_m2_day": PUNE_SUN, "monthly_units": [350.0] * 12,
     "roof_area_sqft": 500, "shading": "none", "sanctioned_load_kw": 4, "tariff": "adani-mumbai",
     "size_override_kw": 3.5, "cost_override_inr": 210000, "tariff_escalation": 0.05},
    {"name": "bengaluru_bescom", "irradiance_kwh_m2_day": BENGALURU_SUN, "monthly_units": [300.0] * 12,
     "roof_area_sqft": 400, "shading": "none", "sanctioned_load_kw": 4, "tariff": "bescom",
     "bill": {"supply": "single", "load_kw": 4, "inputs": {}}},
    {"name": "delhi_bses", "irradiance_kwh_m2_day": DELHI_SUN, "monthly_units": [450.0] * 12,
     "roof_area_sqft": 500, "shading": "none", "sanctioned_load_kw": 5, "tariff": "bses-rajdhani",
     "bill": {"supply": "single", "load_kw": 5, "inputs": {"ppac": 18}}},
    {"name": "tiny_roof", "irradiance_kwh_m2_day": PUNE_SUN, "monthly_units": [200.0] * 12,
     "roof_area_sqft": 90, "shading": "none", "sanctioned_load_kw": 2, "tariff": "msedcl"},
]


# The sample household on the landing page: a Pune flat on MSEDCL.
SAMPLE_HOUSEHOLD: dict[str, Any] = {
    "city": "Pune",
    "lat": 18.52,
    "lng": 73.86,
    "irradiance_kwh_m2_day": PUNE_SUN,
    "monthly_units": [280.0] * 12,
    "roof_area_sqft": 350,
    "shading": "none",
    "sanctioned_load_kw": 3,
    "tariff": "msedcl",
}


def sample_household() -> dict[str, Any]:
    inp = {k: v for k, v in SAMPLE_HOUSEHOLD.items() if k not in ("city", "lat", "lng")}
    inp["tariff"] = load_tariff(SAMPLE_HOUSEHOLD["tariff"])
    report = calc_solar(SolarInputs.model_validate(inp))
    return {"inputs": SAMPLE_HOUSEHOLD, "report": report.model_dump(mode="json")}


def tariff_fixtures() -> list[dict[str, Any]]:
    out = []
    for case in TARIFF_CASES:
        b = bill_breakdown(case["units"], load_tariff(case["tariff"]), BillContext(**case["ctx"]))
        out.append({**case, "expected": {"charges": b.charges, "total": b.total}})
    return out


def solar_fixtures() -> list[dict[str, Any]]:
    out = []
    for case in SOLAR_CASES:
        inp = {k: v for k, v in case.items() if k != "name"}
        inp["tariff"] = load_tariff(case["tariff"])
        r = calc_solar(SolarInputs.model_validate(inp))
        expected = r.model_dump(exclude={"working", "years", "consumption_kwh"})
        expected["working_ids"] = [w.id for w in r.working]
        out.append({**case, "expected": expected})
    return out


def render(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2) + "\n"


def planned_files() -> dict[Path, str]:
    files = {DATA_DST / "constants.json": (DATA_SRC / "constants.json").read_text(encoding="utf-8")}
    for tid in available_tariffs():
        src = DATA_SRC / "tariffs" / f"{tid}.json"
        files[DATA_DST / "tariffs" / f"{tid}.json"] = src.read_text(encoding="utf-8")
    files[DATA_DST / "eval_solar_pvgis.json"] = (DATA_SRC / "eval_solar_pvgis.json").read_text(
        encoding="utf-8"
    )
    files[DATA_DST / "waste.json"] = (DATA_SRC / "waste.json").read_text(encoding="utf-8")
    files[DATA_DST / "eval_leak.json"] = (DATA_SRC / "eval_leak.json").read_text(encoding="utf-8")
    files[DATA_DST / "tariffs" / "index.json"] = render(available_tariffs())
    files[DATA_DST / "sample_household.json"] = render(sample_household())
    files[FIXTURES / "tariff_cases.json"] = render(tariff_fixtures())
    files[FIXTURES / "solar_cases.json"] = render(solar_fixtures())
    return files


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    files = planned_files()
    for path, content in files.items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current != content:
            stale.append(path)
            if not check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8", newline="\n")
    # Remove copies of tariffs that no longer exist
    tariff_dir = DATA_DST / "tariffs"
    if tariff_dir.exists():
        for p in tariff_dir.glob("*.json"):
            if p not in files and p.parent == tariff_dir:
                stale.append(p)
                if not check:
                    p.unlink()
    if check and stale:
        print("Out of date (run scripts/sync_calc.py):")
        for p in stale:
            print("  ", p.relative_to(ROOT))
        return 1
    print("calc data and fixtures are up to date" if check else f"wrote {len(stale)} file(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
