"""Projected solar results across the Kaggle "Indian household electricity bill" dataset
(suraj520/indian-household-electricity-bill), Maharashtra cities only (MSEDCL tariff).

The dataset looks generated (each bill is exactly units × rate, and the "Company" column
lists transmission and equipment firms), so it is used only as a spread of monthly
consumption. Each household runs through the app's own engine with the real MSEDCL
tariff and live NASA POWER sunlight for its city.

Assumptions (the dataset has no roof or load data): 400 sq ft open roof (an independent
house, docs' conservative figure), 3 kW sanctioned load, single phase, no shading.

Run:  services/api/.venv/Scripts/python scripts/results_dataset.py
Writes data/eval/results-dataset.json.
"""

import csv
import json
import statistics as st
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.services import irradiance, solar_reports  # noqa: E402

CITIES = {
    "Pune": (18.52, 73.86),
    "Nagpur": (21.15, 79.09),
    "Navi Mumbai": (19.03, 73.03),
    "Ratnagiri": (16.99, 73.30),
}
SUN = {c: irradiance.fetch_nasa(*ll) for c, ll in CITIES.items()}
_current = {"city": "Pune"}
irradiance.monthly_irradiance = lambda lat, lng: (
    SUN[_current["city"]],
    "NASA POWER 2001-2020 climatology",
)  # type: ignore[assignment]

_cache: dict[tuple[str, int], dict[str, float]] = {}


def run(city: str, units: int) -> dict[str, float]:
    key = (city, units)
    if key not in _cache:
        _current["city"] = city
        lat, lng = CITIES[city]
        bill = solar_reports.BillIn(
            discom="msedcl",
            units_kwh=units,
            period_start=date(2026, 8, 1),
            period_end=date(2026, 8, 31),
            sanctioned_load_kw=3,
            supply="single",
        )
        roof = solar_reports.Roof(lat=lat, lng=lng, roof_area_sqft=400, shading="none")
        r = solar_reports.build_report(bill, roof, solar_reports.Scenario())["report"]
        _cache[key] = {
            k: r[k]
            for k in (
                "size_kw",
                "net_cost_inr",
                "subsidy_inr",
                "savings_year1_inr",
                "payback_years",
                "annual_generation_kwh",
                "co2_avoided_t_per_year",
            )
        }
    return _cache[key]


def main() -> None:
    rows = [
        r
        for r in csv.DictReader(
            open(
                ROOT / "data" / "datasets" / "electricity_bill_dataset.csv",
                encoding="utf-8",
            )
        )
        if r["City"] in CITIES
    ]
    res = [
        {
            "city": r["City"],
            "units": round(float(r["MonthlyHours"])),
            **run(r["City"], round(float(r["MonthlyHours"]))),
        }
        for r in rows
    ]
    pb = [x["payback_years"] for x in res if x["payback_years"] is not None]
    bins = {
        "Under 2 years": 0,
        "2–3 years": 0,
        "3–4 years": 0,
        "4–5 years": 0,
        "Over 5 years": 0,
    }
    for p in pb:
        bins[
            "Under 2 years"
            if p < 2
            else "2–3 years"
            if p < 3
            else "3–4 years"
            if p < 4
            else "4–5 years"
            if p < 5
            else "Over 5 years"
        ] += 1
    by_city = {
        c: {
            "households": sum(1 for x in res if x["city"] == c),
            "median_units": st.median(x["units"] for x in res if x["city"] == c),
            "median_payback": round(
                st.median(x["payback_years"] for x in res if x["city"] == c), 2
            ),
            "median_savings": round(
                st.median(x["savings_year1_inr"] for x in res if x["city"] == c)
            ),
        }
        for c in CITIES
    }
    out = {
        "source": "Kaggle suraj520/indian-household-electricity-bill (values appear generated); Maharashtra cities",
        "households": len(res),
        "median_units": st.median(x["units"] for x in res),
        "median_payback_years": round(st.median(pb), 2),
        "share_payback_under_5": round(sum(1 for p in pb if p < 5) / len(pb), 3),
        "median_savings_year1_inr": round(
            st.median(x["savings_year1_inr"] for x in res)
        ),
        "median_size_kw": st.median(x["size_kw"] for x in res),
        "total_kw": round(sum(x["size_kw"] for x in res)),
        "total_generation_gwh": round(
            sum(x["annual_generation_kwh"] for x in res) / 1e6, 2
        ),
        "total_savings_year1_crore": round(
            sum(x["savings_year1_inr"] for x in res) / 1e7, 2
        ),
        "total_subsidy_crore": round(sum(x["subsidy_inr"] for x in res) / 1e7, 2),
        "total_co2_t": round(sum(x["co2_avoided_t_per_year"] for x in res)),
        "payback_bins": bins,
        "by_city": by_city,
    }
    (ROOT / "data" / "eval" / "results-dataset.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
