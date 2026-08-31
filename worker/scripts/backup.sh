#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/kys-fund-${STAMP}.sql"
npx wrangler d1 export kys-fund-db --remote --output "$OUT"
echo "D1 backup saved to $OUT"
