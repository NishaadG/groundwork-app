"""Vision evals against real photos. Needs AWS credentials and Bedrock access.

Layout (git-ignored, under data/eval/):
  bills/<name>.<jpg|png|pdf>   + bills/truth.csv     columns: file,discom,units,period_start,period_end,amount
  waste/<material>/<name>.jpg  (folder name = the correct material id from waste.json)
  meters/<name>.jpg            + meters/truth.csv    columns: file,litres

Run:  services/api/.venv/Scripts/python scripts/eval_vision.py bills|waste|meters
Writes data/eval/results-<kind>.json and prints a summary. Report misses honestly.
"""

import csv
import io
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.services import extraction, water  # noqa: E402
from app.services import waste as waste_svc  # noqa: E402

EVAL = ROOT / "data" / "eval"
TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}


def model_call(block: dict[str, Any], prompt: str, tool: str, schema: dict[str, Any]) -> dict[str, Any]:
    from app.config import get_settings

    res = extraction.bedrock().converse(
        modelId=get_settings().vision_model_id,
        messages=[{"role": "user", "content": [block, {"text": prompt}]}],
        toolConfig={
            "tools": [{"toolSpec": {"name": tool, "description": tool, "inputSchema": {"json": schema}}}],
            "toolChoice": {"tool": {"name": tool}},
        },
        inferenceConfig={"temperature": 0, "maxTokens": 2000},
    )
    return next(p["toolUse"]["input"] for p in res["output"]["message"]["content"] if "toolUse" in p)


def block_for(path: Path) -> dict[str, Any]:
    return extraction._image_block(path.read_bytes(), TYPES[path.suffix.lower()])


def close(a: float | None, b: float, tol: float) -> bool:
    return a is not None and abs(float(a) - b) <= tol


def bills() -> dict[str, Any]:
    rows = list(csv.DictReader(io.open(EVAL / "bills" / "truth.csv", encoding="utf-8")))
    hits = {"units": 0, "period": 0, "amount": 0, "discom": 0, "flagged_misses": 0}
    misses = []
    for row in rows:
        out = extraction.interpret(model_call(block_for(EVAL / "bills" / row["file"]), extraction.PROMPT, "record_bill", extraction.SCHEMA))
        f = out.fields
        units_ok = close(f["units_consumed_kwh"].value, float(row["units"]), 0.5)
        period_ok = f["billing_period_start"].value == row["period_start"] and f["billing_period_end"].value == row["period_end"]
        amount_ok = close(f["total_amount_inr"].value, float(row["amount"]), 1)
        hits["units"] += units_ok
        hits["period"] += period_ok
        hits["amount"] += amount_ok
        hits["discom"] += out.discom_id == row["discom"]
        if not units_ok:
            flagged = f["units_consumed_kwh"].confidence == "low"
            hits["flagged_misses"] += flagged
            misses.append({"file": row["file"], "read": f["units_consumed_kwh"].value, "truth": row["units"], "flagged_low": flagged})
    n = len(rows)
    return {"n": n, **{k: round(v / n, 3) for k, v in hits.items() if k != "flagged_misses"}, "unit_misses_flagged": hits["flagged_misses"], "misses": misses, "targets": {"units": 0.95, "period": 0.9, "amount": 0.9}}


def waste() -> dict[str, Any]:
    paths = sorted((EVAL / "waste").glob("*/*.jpg"))
    correct, misses = 0, []
    mats = waste_svc.materials()
    for p in paths:
        truth = p.parent.name
        raw = model_call(block_for(p), waste_svc.PROMPT, "record_waste", waste_svc.schema())
        got = [i.get("material") for i in raw.get("items", [])]
        stream_ok = bool(got) and mats.get(got[0], {}).get("stream") == mats[truth]["stream"]
        correct += stream_ok
        if not stream_ok:
            misses.append({"file": p.name, "truth": truth, "got": got})
    return {"n": len(paths), "category_accuracy": round(correct / max(len(paths), 1), 3), "misses": misses, "target": 0.85}


def meters() -> dict[str, Any]:
    rows = list(csv.DictReader(io.open(EVAL / "meters" / "truth.csv", encoding="utf-8")))
    ok, misses = 0, []
    for row in rows:
        raw = model_call(block_for(EVAL / "meters" / row["file"]), water.METER_PROMPT, "record_meter", water.METER_SCHEMA)
        litres = None
        if isinstance(raw.get("reading"), int | float) and raw.get("unit") in water.TO_LITRES:
            litres = raw["reading"] * water.TO_LITRES[raw["unit"]]
        hit = close(litres, float(row["litres"]), 1)
        ok += hit
        if not hit:
            misses.append({"file": row["file"], "read": litres, "truth": row["litres"], "confidence": raw.get("confidence")})
    return {"n": len(rows), "exact": round(ok / max(len(rows), 1), 3), "misses": misses, "target": 0.9}


if __name__ == "__main__":
    kind = sys.argv[1]
    result = {"bills": bills, "waste": waste, "meters": meters}[kind]()
    result["run_on"] = date.today().isoformat()
    (EVAL / f"results-{kind}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "misses"}, indent=2))
