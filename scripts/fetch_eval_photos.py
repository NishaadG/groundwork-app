"""Download small public photo samples for scripts/eval_photos.py into data/eval/ (git-ignored).

  waste/<class>/*.jpg   TrashNet (MIT), 6 per class, from its GitHub zip (the trash class is skipped)
  meters/*.jpg          water-meter photos (CC BY-NC-ND, evaluation use only, never redistributed);
                        the true reading is in each file name (id_N_value_359_439 = 359.439 m3)
  meters/truth.csv      file,litres

Run:  python scripts/fetch_eval_photos.py [per_class=6] [meters=30]
"""

import csv
import io
import json
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

EVAL = Path(__file__).resolve().parent.parent / "data" / "eval"
HF = "https://huggingface.co"
TRASHNET = "https://github.com/garythung/trashnet/raw/master/data/dataset-resized.zip"
UA = {"User-Agent": "groundwork-eval/1.0"}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def waste(per_class: int) -> None:
    zf = zipfile.ZipFile(io.BytesIO(get(TRASHNET)))
    by_class: dict[str, list[str]] = {}
    for name in sorted(zf.namelist()):
        parts = name.split("/")
        if len(parts) == 3 and parts[1] != "trash" and name.endswith(".jpg"):
            by_class.setdefault(parts[1], []).append(name)
    for label, names in by_class.items():
        out = EVAL / "waste" / label
        out.mkdir(parents=True, exist_ok=True)
        for name in names[:: max(len(names) // per_class, 1)][:per_class]:
            (out / Path(name).name).write_bytes(zf.read(name))
    print("waste:", {p.name: len(list(p.glob("*.jpg"))) for p in (EVAL / "waste").iterdir()})


def meters(n: int) -> None:
    tree = json.loads(get(f"{HF}/api/datasets/UniDataPro/water-meters/tree/main/images"))
    files = sorted(t["path"] for t in tree if t["path"].endswith((".jpg", ".png")))[:n]
    out = EVAL / "meters"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in files:
        m = re.search(r"value_(\d+)_(\d+)", path)
        if not m:
            continue
        name = Path(path).name
        url = f"{HF}/datasets/UniDataPro/water-meters/resolve/main/{urllib.parse.quote(path)}"
        (out / name).write_bytes(get(url))
        rows.append({"file": name, "litres": round(float(f"{m[1]}.{m[2]}") * 1000, 3)})
    with open(out / "truth.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["file", "litres"])
        w.writeheader()
        w.writerows(rows)
    print("meters:", len(rows))


if __name__ == "__main__":
    waste(int(sys.argv[1]) if len(sys.argv) > 1 else 6)
    meters(int(sys.argv[2]) if len(sys.argv) > 2 else 30)
