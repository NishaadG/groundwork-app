"""Modelled results for the same household in five cities, each on its own DISCOM's tariff,
using live NASA POWER sunlight. Same code path as the app's solar report.

Run:  services/api/.venv/Scripts/python scripts/results_by_city.py
Writes data/eval/results-by-city.json and prints a table.
"""

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.services import irradiance, solar_reports  # noqa: E402

# The app caches sunlight in DynamoDB; here we fetch it straight from NASA POWER.
irradiance.monthly_irradiance = lambda lat, lng: (  # type: ignore[assignment]
    irradiance.fetch_nasa(lat, lng),
    "NASA POWER 2001-2020 climatology",
)

HOMES = [
    ("Pune", "msedcl", 18.52, 73.86),
    ("Mumbai (Tata Power)", "tata-power-mumbai", 19.08, 72.88),
    ("Mumbai (Adani)", "adani-mumbai", 19.08, 72.88),
    ("Bengaluru", "bescom", 12.97, 77.59),
    ("Delhi", "bses-rajdhani", 28.61, 77.21),
]
KEYS = (
    "size_kw",
    "cost_inr",
    "subsidy_inr",
    "net_cost_inr",
    "savings_year1_inr",
    "payback_years",
    "annual_generation_kwh",
    "co2_avoided_t_per_year",
    "savings_25y_net_inr",
)


def run(discom: str, lat: float, lng: float, units: float) -> dict[str, float]:
    bill = solar_reports.BillIn(
        discom=discom,
        units_kwh=units,
        period_start=date(2026, 8, 1),
        period_end=date(2026, 8, 31),
        sanctioned_load_kw=3,
        supply="single",
    )
    roof = solar_reports.Roof(lat=lat, lng=lng, roof_area_sqft=350, shading="none")
    r = solar_reports.build_report(bill, roof, solar_reports.Scenario())["report"]
    return {k: r[k] for k in KEYS}


def main() -> None:
    cities = [
        {"city": c, "discom": d, **run(d, lat, lng, 280)} for c, d, lat, lng in HOMES
    ]
    sweep = [{"units": u, **run("msedcl", 18.52, 73.86, u)} for u in (150, 280, 450)]
    out = {
        "household": "280 units a month, 350 sq ft open roof, 3 kW sanctioned load, single phase, no shading",
        "cities": cities,
        "pune_by_use": sweep,
    }
    path = ROOT / "data" / "eval" / "results-by-city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    for r in cities:
        print(
            f"{r['city']:<22} {r['size_kw']:.1f} kW  net ₹{r['net_cost_inr']:,.0f}  yr1 ₹{r['savings_year1_inr']:,.0f}  "
            f"payback {r['payback_years']} y  {r['annual_generation_kwh']:,.0f} kWh  {r['co2_avoided_t_per_year']:.2f} t"
        )
    for r in sweep:
        print(
            f"Pune {r['units']} units: {r['size_kw']:.1f} kW  yr1 ₹{r['savings_year1_inr']:,.0f}  payback {r['payback_years']} y"
        )


if __name__ == "__main__":
    main()
