"""Copilot routing eval: 20 scripted prompts in English, Hindi and Marathi.

Each prompt must reach the right agent (or ledger tool, or none for off-topic), and
every number in the reply must trace to a tool result (app.agents.guard).

Storage is mocked with moto and seeded with one household (two bills, a solar
report, water readings, a waste log). The model calls go to real Bedrock, so this
needs AWS credentials and Nova access:

  services/api/.venv/Scripts/python scripts/eval_copilot.py           # real Bedrock
  services/api/.venv/Scripts/python scripts/eval_copilot.py --offline # harness check, keyword router

Writes data/eval/results-copilot.json and prints a table. Report misses honestly.
"""

import asyncio
import json
import os
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))
os.environ.setdefault("TABLE_NAME", "groundwork-eval")
os.environ.setdefault("UPLOADS_BUCKET", "groundwork-eval-uploads")
os.environ.setdefault("COGNITO_USER_POOL_ID", "ap-south-1_eval")

import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

from app import db, storage  # noqa: E402
from app.agents.guard import untraced_numbers  # noqa: E402
from app.agents.scripted import ScriptedModel, Turn  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.services import chat, irradiance, solar_reports, waste, water  # noqa: E402

SUB = "eval-household"
PROMPTS: list[tuple[str, str, str]] = [
    # (lang, prompt, expected route)
    ("en", "Is rooftop solar worth it for my home?", "solar_agent"),
    ("en", "Why was my last electricity bill higher than usual?", "solar_agent"),
    ("en", "How big a solar system can my roof take?", "solar_agent"),
    ("en", "How do I apply for the PM Surya Ghar subsidy?", "solar_agent"),
    ("en", "Do I have a water leak?", "water_agent"),
    ("en", "How much water does my family use per person?", "water_agent"),
    ("en", "How do I clean our overhead water tank safely?", "water_agent"),
    ("en", "Can I recycle a greasy pizza box?", "waste_agent"),
    ("en", "What does a kabadiwala pay for newspaper?", "waste_agent"),
    ("en", "How much have I saved so far?", "get_ledger"),
    ("en", "Write me a poem about cricket.", "none"),
    ("en", "Who can pick up my scrap?", "waste_agent"),
    ("hi", "क्या मेरे घर के लिए छत पर सोलर लगाना फायदेमंद है?", "solar_agent"),
    ("hi", "क्या मेरे घर में पानी लीक हो रहा है?", "water_agent"),
    ("hi", "चिप्स का पैकेट किस कचरे में जाता है?", "waste_agent"),
    ("hi", "मैंने अब तक कितनी बचत की है?", "get_ledger"),
    ("mr", "माझ्या घरासाठी छतावर सोलर बसवणे फायदेशीर आहे का?", "solar_agent"),
    ("mr", "माझ्या घरात पाण्याची गळती आहे का?", "water_agent"),
    ("mr", "प्लास्टिकच्या बाटल्या कोणत्या कचऱ्यात टाकाव्यात?", "waste_agent"),
    ("mr", "मी आतापर्यंत किती बचत केली आहे?", "get_ledger"),
]
ROUTES = ("solar_agent", "water_agent", "waste_agent", "get_ledger", "get_profile")


def create_storage() -> None:
    s = get_settings()
    boto3.client("dynamodb", region_name=s.aws_region).create_table(
        TableName=s.table_name,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": n, "AttributeType": "S"}
            for n in ("PK", "SK", "GSI1PK", "GSI1SK")
        ],
        KeySchema=[
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "GSI1",
                "KeySchema": [
                    {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                    {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
    )
    boto3.client("s3", region_name=s.aws_region).create_bucket(
        Bucket=s.uploads_bucket,
        CreateBucketConfiguration={"LocationConstraint": s.aws_region},
    )
    db.reset_clients()
    storage.reset_clients()


def seed() -> None:
    """One Pune household with enough data for every agent to have something to say."""
    db.upsert_profile(
        SUB,
        {
            "name": "Asha",
            "city": "Pune",
            "state": "Maharashtra",
            "household_size": 4,
            "discom": "msedcl",
            "roof_area_sqft": 350,
            "water_source": "municipal",
            "tank_litres": 1000,
            "onboarding_done": True,
        },
        "asha@example.com",
    )
    # Pune monthly mean irradiance (kWh/m²/day), so no network call to NASA POWER
    irradiance.fetch_nasa = lambda lat, lng: [
        4.99,
        5.85,
        6.61,
        6.86,
        6.68,
        4.53,
        3.73,
        3.87,
        4.83,
        5.27,
        5.07,
        4.73,
    ]  # type: ignore[assignment]
    bills = []
    for start, end, units, amount in (
        ("2026-07-01", "2026-07-31", 260, 3080),
        ("2026-08-01", "2026-08-31", 305, 3720),
    ):
        bills.append(
            solar_reports.save_bill(
                SUB,
                solar_reports.BillIn(
                    discom="msedcl",
                    units_kwh=units,
                    period_start=date.fromisoformat(start),
                    period_end=date.fromisoformat(end),
                    total_amount_inr=amount,
                    sanctioned_load_kw=3,
                ),
            )
        )
    solar_reports.create_report(
        SUB,
        solar_reports.ReportIn(
            bill_id=bills[-1]["id"],
            roof={"lat": 18.52, "lng": 73.86, "roof_area_sqft": 350, "shading": "none"},
        ),  # type: ignore[arg-type]
    )
    now = datetime.now(UTC)
    for i, value in enumerate((482_100, 482_640, 483_190, 483_700)):
        water.add_reading(
            SUB,
            water.ReadingIn(kind="meter", value=value, at=now - timedelta(days=3 - i)),
        )
    waste.save_scan(
        SUB,
        waste.ScanIn(
            items=[
                waste.ScanItemIn(material="newspaper", kg=5),
                waste.ScanItemIn(material="pet", size="bag"),
            ]
        ),
    )


def keyword_router(role: Any) -> ScriptedModel:
    """--offline: route by keywords and answer from the tool result, to check the harness."""
    words = {
        "solar_agent": ("solar", "bill", "सोलर", "subsidy"),
        "water_agent": ("water", "leak", "पानी", "पाण्या", "tank"),
        "waste_agent": (
            "recycle",
            "kabadiwala",
            "scrap",
            "कचर",
            "कचऱ",
            "pizza",
            "bottle",
        ),
        "get_ledger": ("saved", "बचत"),
    }

    def respond(
        messages: list[dict[str, Any]], _sp: str | None, tools: list[str]
    ) -> Turn:
        last = messages[-1]["content"]
        if any("toolResult" in c for c in last):
            return Turn(text="Here is what I found in your data.")
        text = next((c.get("text", "") for c in last if "text" in c), "").lower()
        if role == "orchestrator":
            for route, kws in words.items():
                if any(k in text for k in kws):
                    return Turn(
                        tool_calls=[
                            (route, {"input": text} if route.endswith("_agent") else {})
                        ]
                    )
            return Turn(text="I can help with electricity, water and waste.")
        first = {
            "solar": "get_bills",
            "water": "get_water_summary",
            "waste": "get_waste_summary",
        }[role]
        return Turn(tool_calls=[(first, {})])

    return ScriptedModel(respond)


async def ask(lang: str, prompt: str) -> dict[str, Any]:
    session_id, session = chat.prepare(SUB, chat.ChatIn(message=prompt))
    reply, tools = [], []
    started = datetime.now(UTC)
    first_token = None
    async for block in chat.stream(
        SUB, lang, chat.ChatIn(message=prompt), session_id, session
    ):
        event, data = block.split("\n")[0][7:], json.loads(block.split("\n")[1][6:])
        if event == "token":
            first_token = first_token or (datetime.now(UTC) - started).total_seconds()
            reply.append(data["text"])
        elif event == "tool_start":
            tools.append(data["name"])
        elif event == "error":
            reply.append(f"[error: {data['code']}]")
    text = "".join(reply)
    return {
        "route": next((t for t in tools if t in ROUTES), "none"),
        "tools": tools,
        "reply": text,
        "untraced": untraced_numbers(text, session.tool_results, prompt),
        "first_token_s": first_token,
    }


def main() -> None:
    offline = "--offline" in sys.argv
    passthrough = {"core": {"passthrough": {"services": ["bedrock-runtime"]}}}
    with mock_aws(config=passthrough):  # type: ignore[arg-type]
        get_settings.cache_clear()
        s = get_settings()
        s.ai_calls_per_hour = 1000
        create_storage()
        seed()
        if offline:
            chat.model_for = keyword_router
        results = []
        for lang, prompt, expected in PROMPTS:
            r = asyncio.run(ask(lang, prompt))
            r |= {
                "lang": lang,
                "prompt": prompt,
                "expected": expected,
                "ok": r["route"] == expected and not r["untraced"],
            }
            results.append(r)
            mark = "PASS" if r["ok"] else "FAIL"
            print(
                f"{mark}  [{lang}] {prompt[:48]:<48} → {r['route']:<12} untraced={r['untraced']}"
            )
    passed = sum(r["ok"] for r in results)
    times = [r["first_token_s"] for r in results if r["first_token_s"] is not None]
    summary = {
        "mode": "offline keyword router" if offline else f"Bedrock {s.text_model_id}",
        "run_at": datetime.now(UTC).isoformat(),
        "passed": passed,
        "total": len(results),
        "routing_correct": sum(r["route"] == r["expected"] for r in results),
        "replies_with_untraced_numbers": sum(bool(r["untraced"]) for r in results),
        "median_first_token_s": sorted(times)[len(times) // 2] if times else None,
        "results": results,
    }
    out = (
        ROOT
        / "data"
        / "eval"
        / ("results-copilot-offline.json" if offline else "results-copilot.json")
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"\n{passed}/{len(results)} passed ({summary['mode']}). Median first token: {summary['median_first_token_s']} s. Wrote {out}"
    )


if __name__ == "__main__":
    main()
