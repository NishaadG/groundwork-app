#!/usr/bin/env bash
# Lighthouse (mobile) median of 3 runs per page. Usage: scripts/lighthouse.sh <baseUrl> <outDir> <path>...
# On an underpowered host (benchmarkIndex < 1000) pass CPU=1 to calibrate throttling,
# per Lighthouse's throttling guide. The DoD is confirmed on the deployed URL with PageSpeed Insights.
base="$1"; out="$2"; shift 2
chrome="${CHROME_PATH:-$(ls -d "$LOCALAPPDATA"/ms-playwright/chromium-*/chrome-win64/chrome.exe 2>/dev/null | head -1)}"
for p in "$@"; do
  name=$(echo "${p#/}" | tr '/' '_'); name=${name:-home}
  for i in 1 2 3; do
    CHROME_PATH="$chrome" MSYS_NO_PATHCONV=1 timeout 200 pnpm --dir "$(dirname "$0")/../apps/web" dlx lighthouse@12 "$base$p" --quiet \
      --chrome-flags="--headless=new" --throttling.cpuSlowdownMultiplier="${CPU:-4}" \
      --output=json --output-path="$out/lh-$name-$i.json" --form-factor=mobile >/dev/null 2>&1
  done
  PYTHONUTF8=1 python - "$out" "$name" <<'PY'
import json, statistics, sys
out, name = sys.argv[1], sys.argv[2]
runs = [json.load(open(f"{out}/lh-{name}-{i}.json", encoding="utf-8")) for i in (1, 2, 3)]
cats = runs[0]["categories"].keys()
med = {c: round(statistics.median(r["categories"][c]["score"] for r in runs) * 100) for c in cats}
lcp = statistics.median(r["audits"]["largest-contentful-paint"]["numericValue"] for r in runs) / 1000
tbt = statistics.median(r["audits"]["total-blocking-time"]["numericValue"] for r in runs)
cls = statistics.median(r["audits"]["cumulative-layout-shift"]["numericValue"] for r in runs)
bench = [round(r["environment"]["benchmarkIndex"]) for r in runs]
print(f"{name:14} {med}  LCP {lcp:.1f}s  TBT {tbt:.0f}ms  CLS {cls:.3f}  bench {bench}")
PY
done
