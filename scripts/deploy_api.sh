#!/usr/bin/env bash
# Usage: scripts/deploy_api.sh [dev|prod]   (default: dev)
set -euo pipefail

env="${1:-dev}"
root="$(cd "$(dirname "$0")/.." && pwd)"

"$root/scripts/build_api.sh"
cd "$root/infra"
sam deploy --config-env "$( [ "$env" = dev ] && echo default || echo "$env" )"
