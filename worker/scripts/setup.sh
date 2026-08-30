#!/usr/bin/env bash
# One-time setup after `wrangler deploy`:
#   1. Seeds your Telegram ID as the owner admin
#   2. Registers the Telegram webhook against your deployed Worker
#
# Usage: ./scripts/setup.sh <WORKER_URL> <YOUR_TELEGRAM_ID> <YOUR_NAME>
# Requires: TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET already set as
# wrangler secrets, and wrangler CLI logged in.

set -euo pipefail

WORKER_URL="${1:?Usage: setup.sh <worker-url> <telegram-id> <your-name>}"
TELEGRAM_ID="${2:?Missing your Telegram ID}"
NAME="${3:?Missing your name}"

echo "Seeding owner admin..."
wrangler d1 execute kys-fund-db --remote --command \
  "INSERT OR IGNORE INTO admins (telegram_id, name, role) VALUES ('${TELEGRAM_ID}', '${NAME}', 'owner');"

echo "Registering Telegram webhook at ${WORKER_URL}/telegram/webhook ..."
BOT_TOKEN=$(wrangler secret list | grep -q TELEGRAM_BOT_TOKEN && echo "(set as secret — set curl call manually if needed)")
echo "Run this manually with your real bot token and webhook secret:"
echo ""
echo "curl -F \"url=${WORKER_URL}/telegram/webhook\" \\"
echo "     -F \"secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>\" \\"
echo "     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook"
echo ""
echo "Done seeding admin. Complete the webhook registration above."
