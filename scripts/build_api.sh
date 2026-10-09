#!/usr/bin/env bash
# Packages services/api for Lambda (Python 3.12, arm64) into infra/.build/api.
# Uses uv to fetch Linux arm64 wheels, so it works on Windows/macOS without Docker.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/infra/.build/api"

rm -rf "$out"
mkdir -p "$out"

# boto3 is not pinned for the package (the Lambda runtime has one), but strands-agents
# pulls in a recent boto3 anyway, which the copilot needs for ConverseStream
reqs="$out.requirements.txt"
grep -v '^boto3' "$root/services/api/requirements.txt" > "$reqs"
uv pip install \
  --target "$out" \
  --python-version 3.12 \
  --python-platform aarch64-manylinux2014 \
  --only-binary :all: \
  -r "$reqs"
rm -f "$reqs"

cp -r "$root/services/api/app" "$out/app"
cp "$root/services/api/run.sh" "$out/run.sh"
find "$out" -name "__pycache__" -type d -prune -exec rm -rf {} +

echo "Built API package at $out"
