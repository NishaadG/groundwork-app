"""Eval: Groundwork's annual generation vs PVGIS (target within ±12%).

For each city: fetch NASA POWER monthly irradiance, run calc.solar's specific yield
for 1 kW, and compare with PVGIS PVcalc (1 kWp, 14% loss, horizontal like our model,
and at PVGIS's optimal tilt for reference). Writes the table to
services/api/app/data/eval_solar_pvgis.json (synced to the web Methodology page).

Run from the repo root:  services/api/.venv/Scripts/python scripts/eval_solar_pvgis.py
"""

import json
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.calc.solar import specific_yield  # noqa: E402

CITIES = [
    ("Pune", 18.52, 73.86),
    ("Mumbai", 19.08, 72.88),
    ("Bengaluru", 12.97, 77.59),
    ("Delhi", 28.61, 77.21),
    ("Chennai", 13.08, 80.27),
]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
UA = {"User-Agent": "Groundwork-eval/1.0 (independent project)"}


def get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def nasa_irradiance(lat: float, lng: float) -> list[float]:
    url = (
        "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN"
        f"&community=RE&longitude={lng}&latitude={lat}&format=JSON"
    )
    data = get_json(url)["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]
    return [float(data[m]) for m in MONTHS]


def pvgis_yearly(lat: float, lng: float, optimal: bool) -> float:
    url = (
        f"https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat={lat}&lon={lng}&peakpower=1&loss=14"
        f"&outputformat=json{'&optimalangles=1' if optimal else '&angle=0'}"
    )
    return float(get_json(url)["outputs"]["totals"]["fixed"]["E_y"])


def main() -> None:
    rows = []
    for city, lat, lng in CITIES:
        ours = sum(specific_yield(nasa_irradiance(lat, lng), "none"))
        flat = pvgis_yearly(lat, lng, optimal=False)
        tilted = pvgis_yearly(lat, lng, optimal=True)
        rows.append(
            {
                "city": city,
                "lat": lat,
                "lng": lng,
                "groundwork_kwh_per_kw": round(ours, 1),
                "pvgis_flat_kwh_per_kw": round(flat, 1),
                "pvgis_optimal_tilt_kwh_per_kw": round(tilted, 1),
                "diff_vs_flat_pct": round((ours - flat) / flat * 100, 1),
                "diff_vs_tilt_pct": round((ours - tilted) / tilted * 100, 1),
            }
        )
        print(rows[-1])
        time.sleep(1)
    out = {
        "run_on": date.today().isoformat(),
        "target_pct": 12,
        "method": "1 kW, no shading. Groundwork: NASA POWER 2001-2020 climatology x days x PR 0.77. "
        "PVGIS v5.3 PVcalc, 14% system loss, horizontal (angle=0) and at its optimal tilt.",
        "rows": rows,
    }
    path = ROOT / "services" / "api" / "app" / "data" / "eval_solar_pvgis.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
