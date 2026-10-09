"""NASA POWER monthly irradiance, cached per 0.1° cell in DynamoDB.

The climatology (2001–2020) doesn't change, so a cell is fetched once, ever.
"""

import json
import logging
import urllib.parse
import urllib.request
from typing import Any

from app import db
from app.errors import ApiError

log = logging.getLogger("groundwork.irradiance")

MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
NASA_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
SOURCE = "NASA POWER climatology 2001–2020 (ALLSKY_SFC_SW_DWN)"
USER_AGENT = "Groundwork/1.0 (rooftop solar estimates)"


def cell(lat: float, lng: float) -> tuple[float, float]:
    return round(lat, 1), round(lng, 1)


def _fetch_json(url: str, timeout: float = 15) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed https host)
        return json.load(resp)


def fetch_nasa(lat: float, lng: float) -> list[float]:
    query = urllib.parse.urlencode(
        {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": lng,
            "latitude": lat,
            "format": "JSON",
        }
    )
    data = _fetch_json(f"{NASA_URL}?{query}")["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]
    values = [float(data[m]) for m in MONTHS]
    if any(v < 0 for v in values):  # NASA uses -999 for missing
        raise ValueError("missing irradiance values")
    return values


def monthly_irradiance(lat: float, lng: float) -> tuple[list[float], str]:
    clat, clng = cell(lat, lng)
    key = {"PK": f"CACHE#IRRADIANCE#{clat:.1f},{clng:.1f}", "SK": "NASA_POWER"}
    item = db.table().get_item(Key=key).get("Item")
    if item:
        return [float(v) for v in item["values"]], SOURCE
    try:
        values = fetch_nasa(clat, clng)
    except Exception as exc:
        log.warning("NASA POWER fetch failed for %s,%s: %s", clat, clng, exc)
        raise ApiError(
            503, "irradiance_unavailable", "Sunlight data is temporarily unavailable."
        ) from exc
    db.table().put_item(Item={**key, "values": db.to_dynamo(values), "fetched_at": db.now_iso()})
    return values, SOURCE
