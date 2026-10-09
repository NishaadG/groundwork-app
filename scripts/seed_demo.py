"""Fill the public demo account with a lived-in household, through the real API.

Needs: pip install pycognito httpx
Env:   DEMO_EMAIL, DEMO_PASSWORD, API_URL, COGNITO_POOL_ID, COGNITO_CLIENT_ID
The demo account holds no private data; its sign-in is published on the site's demo button.
Run once on a fresh demo user:  python scripts/seed_demo.py
"""

import os
from datetime import UTC, datetime, timedelta

import httpx
from pycognito import Cognito

API = os.environ["API_URL"].rstrip("/")

user = Cognito(
    os.environ["COGNITO_POOL_ID"],
    os.environ["COGNITO_CLIENT_ID"],
    username=os.environ["DEMO_EMAIL"],
)
user.authenticate(password=os.environ["DEMO_PASSWORD"])
http = httpx.Client(
    base_url=API + "/v1",
    headers={"Authorization": f"Bearer {user.id_token}"},
    timeout=60,
)


def call(method: str, path: str, body: dict | None = None) -> dict:
    res = http.request(method, path, json=body)
    if res.status_code >= 300:
        raise SystemExit(f"{method} {path} -> {res.status_code} {res.text[:300]}")
    return res.json().get("data", {})


call(
    "PUT",
    "/me",
    {
        "name": "Meera",
        "lang": "en",
        "home_type": "flat",
        "city": "Pune",
        "state": "Maharashtra",
        "lat": 18.5204,
        "lng": 73.8567,
        "roof_area_sqft": 350,
        "shading": "none",
        "household_size": 4,
        "discom": "msedcl",
        "supply": "single",
        "sanctioned_load_kw": 3,
        "water_source": "municipal",
        "tank_litres": 1000,
        "onboarding_step": 4,
        "onboarding_done": True,
        "leak_reminders": False,
    },
)

bill = call(
    "POST",
    "/bills",
    {
        "discom": "msedcl",
        "units_kwh": 312,
        "period_start": "2026-08-01",
        "period_end": "2026-08-31",
        "total_amount_inr": 3461.5,
        "sanctioned_load_kw": 3,
        "supply": "single",
        "history": [
            {"month": "2026-03", "units": 290},
            {"month": "2026-04", "units": 388},
            {"month": "2026-05", "units": 451},
            {"month": "2026-06", "units": 402},
            {"month": "2026-07", "units": 335},
        ],
        "source": "manual",
    },
)
report = call(
    "POST",
    "/solar/reports",
    {
        "bill_id": bill["id"],
        "roof": {"lat": 18.5204, "lng": 73.8567, "roof_area_sqft": 350, "shading": "none"},
    },
)
print("solar report", report.get("id"))

# An overnight check that finds a leak (about 120 litres a day).
night = datetime.now(UTC) - timedelta(hours=10)
check = call("POST", "/water/leak-check", {"kind": "meter", "value": 482100, "at": night.isoformat()})
call(
    f"POST",
    f"/water/leak-check/{check['id']}/finish",
    {"value": 482140, "at": (night + timedelta(hours=8)).isoformat()},
)

for items in (
    [{"material": "pet", "size": "bag"}, {"material": "newspaper", "kg": 2.5}],
    [{"material": "cardboard", "kg": 3}, {"material": "glass", "size": "handful"}],
    [{"material": "ldpe_film", "size": "bag"}],
):
    call("POST", "/waste/scans", {"items": items})

print("home:", call("GET", "/home").keys())
print("seeded")
