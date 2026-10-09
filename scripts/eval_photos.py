"""Photo-reading evals against the configured model (set AI_PROVIDER / AI_MODEL as in production).

  bills   5 synthetic bill photos (rendered here with known values, then rotated, blurred and
          shaded like a phone photo). Synthetic: it tests reading and the code checks, not the
          variety of real DISCOM layouts.
  waste   data/eval/waste/<trashnet class>/*.jpg  -> does the first item fall in the right family
  meters  data/eval/meters/*.jpg + truth.csv       -> reading vs truth

Get the photos first:  python scripts/fetch_eval_photos.py
Run:  services/api/.venv/Scripts/python scripts/eval_photos.py [bills] [waste] [meters]
Writes data/eval/photo_eval.json. The key is read from SSM, or set AI_API_KEY.
"""

import csv
import io
import json
import os
import random
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

os.environ.setdefault("AI_PROVIDER", "gemini")
os.environ.setdefault("AI_KEY_PARAM", "/groundwork/ai-key")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))

from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.services import extraction, water  # noqa: E402
from app.services import waste as waste_svc  # noqa: E402

EVAL = ROOT / "data" / "eval"

PLASTIC = {"pet", "hdpe", "ldpe_film", "mixed_plastic", "multilayer"}
FAMILIES = {
    "cardboard": {"cardboard"},
    "glass": {"glass"},
    "metal": {"ferrous", "steel", "aluminium", "copper", "brass"},
    "paper": {"newspaper", "mixed_paper"},
    "plastic": PLASTIC,
}


def call(block: dict[str, Any], prompt: str, tool: str, schema: dict[str, Any], tokens: int) -> dict[str, Any]:
    """One forced-tool call, retried on passing overload (the free tier throttles)."""
    for attempt in range(4):
        try:
            res = extraction.bedrock().converse(
                modelId="",
                messages=[{"role": "user", "content": [block, {"text": prompt}]}],
                toolConfig={
                    "tools": [{"toolSpec": {"name": tool, "description": tool, "inputSchema": {"json": schema}}}],
                    "toolChoice": {"tool": {"name": tool}},
                },
                inferenceConfig={"temperature": 0, "maxTokens": tokens},
            )
            return next(p["toolUse"]["input"] for p in res["output"]["message"]["content"] if "toolUse" in p)
        except Exception as exc:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
            print(f"  retry after {type(exc).__name__}", file=sys.stderr)
    raise RuntimeError("unreachable")


def image_block(data: bytes) -> dict[str, Any]:
    return extraction._image_block(data, "image/jpeg")


# ---- synthetic bills ----


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arialbd.ttf" if bold else "arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def render_bill(b: dict[str, Any], seed: int) -> bytes:
    rnd = random.Random(seed)
    w, h = 1240, 1600
    img = Image.new("RGB", (w, h), (250, 250, 246))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w, 130], fill=(20, 70, 140))
    d.text((40, 25), b["header"], font=_font(34, True), fill="white")
    d.text((40, 75), f"Electricity Bill  |  {b['category']}  |  {b['city']}", font=_font(26), fill="white")
    rows = [
        ("Consumer No.", "1700XXXXXX12"), ("Name", "SHRI A. B. SAMPLE"),
        ("Tariff", f"{b['category']}  {b['phase_text']}"), ("Sanctioned Load", f"{b['load']:.2f} KW"),
        ("Bill Period", f"{b['start']}  to  {b['end']}"), ("Units Consumed", str(b["units"])),
    ]  # fmt: skip
    y = 170
    for k, v in rows:
        d.text((60, y), k, font=_font(28), fill=(60, 60, 60))
        d.text((420, y), ": " + v, font=_font(28, True), fill="black")
        y += 48
    y += 20
    d.line([(40, y), (w - 40, y)], fill="black", width=2)
    y += 20
    for k, v in b["charges"]:
        d.text((60, y), k, font=_font(28), fill="black")
        d.text((900, y), v, font=_font(28), fill="black")
        y += 44
    d.rectangle([40, y + 10, w - 40, y + 80], outline="black", width=3)
    d.text((60, y + 25), "TOTAL AMOUNT PAYABLE (Rs.)", font=_font(32, True), fill="black")
    d.text((900, y + 25), b["total_text"], font=_font(32, True), fill="black")
    img = img.rotate(rnd.uniform(-3, 3), expand=True, fillcolor=(90, 80, 70))
    img = img.filter(ImageFilter.GaussianBlur(rnd.uniform(0.5, 1.2)))
    shade = Image.linear_gradient("L").resize(img.size).point(lambda p: 255 - p // 6)
    img = Image.composite(img, Image.new("RGB", img.size, (40, 40, 40)), shade)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=78)
    return out.getvalue()


SYNTHETIC_BILLS = [
    {"header": "MAHARASHTRA STATE ELECTRICITY DISTRIBUTION CO. LTD.", "discom": "msedcl", "city": "Pune",
     "category": "LT-I Residential", "phase_text": "1-Phase", "load": 3.0, "units": 312,
     "start": "01-08-2026", "end": "31-08-2026", "start_iso": "2026-08-01", "end_iso": "2026-08-31",
     "charges": [("Fixed Charges", "128.00"), ("Energy Charges", "2,465.40"), ("FAC", "45.20")],
     "total": 3461.5, "total_text": "3,461.50"},
    {"header": "MAHARASHTRA STATE ELECTRICITY DISTRIBUTION CO. LTD.", "discom": "msedcl", "city": "Nagpur",
     "category": "LT-I Residential", "phase_text": "1-Phase", "load": 2.0, "units": 148,
     "start": "05-06-2026", "end": "04-07-2026", "start_iso": "2026-06-05", "end_iso": "2026-07-04",
     "charges": [("Fixed Charges", "128.00"), ("Energy Charges", "1,020.00"), ("FAC", "12.40")],
     "total": 1530.0, "total_text": "1,530.00"},
    {"header": "BANGALORE ELECTRICITY SUPPLY COMPANY LIMITED (BESCOM)", "discom": "bescom", "city": "Bengaluru",
     "category": "LT-2(a) Domestic", "phase_text": "1-Phase", "load": 4.0, "units": 275,
     "start": "12-07-2026", "end": "11-08-2026", "start_iso": "2026-07-12", "end_iso": "2026-08-11",
     "charges": [("Fixed Charges", "240.00"), ("Energy Charges", "1,900.00"), ("Tax", "58.00")],
     "total": 2480.0, "total_text": "2,480.00"},
    {"header": "BSES RAJDHANI POWER LIMITED", "discom": "bses-rajdhani", "city": "Delhi",
     "category": "Domestic", "phase_text": "Single Phase", "load": 5.0, "units": 410,
     "start": "01-08-2026", "end": "31-08-2026", "start_iso": "2026-08-01", "end_iso": "2026-08-31",
     "charges": [("Fixed Charges", "250.00"), ("Energy Charges", "2,700.00"), ("PPAC", "130.00")],
     "total": 3380.0, "total_text": "3,380.00"},
    {"header": "MAHARASHTRA STATE ELECTRICITY DISTRIBUTION CO. LTD.", "discom": "msedcl", "city": "Mumbai Suburban",
     "category": "LT-I Residential", "phase_text": "3-Phase", "load": 7.5, "units": 689,
     "start": "01-09-2026", "end": "30-09-2026", "start_iso": "2026-09-01", "end_iso": "2026-09-30",
     "charges": [("Fixed Charges", "480.00"), ("Energy Charges", "6,800.00"), ("FAC", "90.00")],
     "total": 8210.0, "total_text": "8,210.00"},
]  # fmt: skip


def close(a: Any, b: float, tol: float) -> bool:
    return isinstance(a, int | float) and abs(float(a) - b) <= tol


def eval_bills() -> dict[str, Any]:
    keys = ("units", "period", "amount", "discom", "load")
    hits = dict.fromkeys(keys, 0)
    misses, flagged_wrong = [], 0
    for i, b in enumerate(SYNTHETIC_BILLS):
        out = extraction.interpret(call(image_block(render_bill(b, i)), extraction.PROMPT, "record_bill", extraction.SCHEMA, 2000))
        f = out.fields
        ok = {
            "units": close(f["units_consumed_kwh"].value, b["units"], 0.5),
            "period": f["billing_period_start"].value == b["start_iso"] and f["billing_period_end"].value == b["end_iso"],
            "amount": close(f["total_amount_inr"].value, b["total"], 1),
            "discom": out.discom_id == b["discom"],
            "load": close(f["sanctioned_load_kw"].value, b["load"], 0.05),
        }
        for k in keys:
            hits[k] += ok[k]
        if not all(ok.values()):
            wrong = [k for k, v in ok.items() if not v]
            low = [k for k in wrong if k == "units" and f["units_consumed_kwh"].confidence == "low"]
            flagged_wrong += bool(low)
            misses.append({"bill": i, "wrong": wrong, "units_read": f["units_consumed_kwh"].value})
        time.sleep(1)
    n = len(SYNTHETIC_BILLS)
    return {"kind": "synthetic bills", "n": n, **{f"{k}_accuracy": round(v / n, 3) for k, v in hits.items()}, "misses": misses}


# ---- waste (TrashNet) ----


def eval_waste() -> dict[str, Any]:
    correct = any_hit = n = 0
    per_class: dict[str, list[int]] = {}
    misses = []
    for folder in sorted((EVAL / "waste").iterdir()):
        for p in sorted(folder.glob("*.jpg")):
            raw = call(image_block(p.read_bytes()), waste_svc.PROMPT, "record_waste", waste_svc.schema(), 800)
            got = [i.get("material") for i in raw.get("items", [])]
            family = FAMILIES[folder.name]
            first_ok = bool(got) and got[0] in family
            any_ok = any(g in family for g in got)
            n += 1
            correct += first_ok
            any_hit += any_ok
            per_class.setdefault(folder.name, []).append(int(first_ok))
            if not first_ok:
                misses.append({"file": f"{folder.name}/{p.name}", "got": got})
            time.sleep(1)
    return {
        "kind": "TrashNet photos (cardboard, glass, metal, paper, plastic)",
        "n": n,
        "first_item_family_accuracy": round(correct / max(n, 1), 3),
        "any_item_family_accuracy": round(any_hit / max(n, 1), 3),
        "per_class": {k: round(sum(v) / len(v), 2) for k, v in per_class.items()},
        "misses": misses,
    }


# ---- water meters ----


def eval_meters() -> dict[str, Any]:
    rows = list(csv.DictReader(open(EVAL / "meters" / "truth.csv", encoding="utf-8")))
    exact = whole = low_conf = wrong_and_confident = 0
    misses = []
    for row in rows:
        raw = call(image_block((EVAL / "meters" / row["file"]).read_bytes()), water.METER_PROMPT, "record_meter", water.METER_SCHEMA, 300)
        litres = None
        if isinstance(raw.get("reading"), int | float) and raw.get("unit") in water.TO_LITRES:
            litres = raw["reading"] * water.TO_LITRES[raw["unit"]]
        truth = float(row["litres"])
        hit = close(litres, truth, 1.5)
        hit_whole = close(litres, truth, 1000)  # right to the nearest m3 (black digits)
        exact += hit
        whole += hit_whole
        conf = raw.get("confidence")
        low_conf += conf == "low"
        wrong_and_confident += (not hit) and conf in ("high", "medium")
        if not hit:
            misses.append({"file": row["file"], "read_litres": litres, "truth_litres": truth, "confidence": conf})
        time.sleep(1)
    n = len(rows)
    return {
        "kind": "water meter photos (public dataset)",
        "n": n,
        "exact_accuracy": round(exact / n, 3),
        "within_one_m3_accuracy": round(whole / n, 3),
        "low_confidence_share": round(low_conf / n, 3),
        "wrong_but_not_flagged": wrong_and_confident,
        "misses": misses,
    }


if __name__ == "__main__":
    kinds = sys.argv[1:] or ["bills", "waste", "meters"]
    path = EVAL / "photo_eval.json"
    result = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    result["model"] = get_settings().ai_model
    result["run_on"] = date.today().isoformat()
    for k in kinds:
        print(f"== {k}", flush=True)
        result[k] = {"bills": eval_bills, "waste": eval_waste, "meters": eval_meters}[k]()
        print(json.dumps({a: b for a, b in result[k].items() if a != "misses"}, indent=1), flush=True)
        path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
