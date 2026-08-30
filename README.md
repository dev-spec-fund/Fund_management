# KYS Fund — Community Fund Management (Telegram Mini App)

A fund management system for a community/society, built as a **Telegram Mini App**.
Members submit monthly contributions by sending a bank transfer slip to the
Telegram bot; admins approve them from Telegram. Everyone can then check
balances, history, and (for admins) run reports — all inside the Mini App.

Runs entirely on **Cloudflare's free tier**: Workers, D1, R2, and Workers AI.

## Stack

- **Backend**: Cloudflare Worker + [Hono](https://hono.dev) + D1 (SQLite) + Workers AI (slip OCR)
- **Bot**: Telegram Bot API, webhook-based, same Worker
- **Frontend**: React + Vite, deployed as a static site on Cloudflare Pages, loaded inside Telegram as a Mini App

## Project layout

```
kys-fund/
  worker/       Cloudflare Worker: API + Telegram bot + D1 schema
  frontend/     React Mini App (Vite)
```

## 1. Prerequisites

- A Cloudflare account (free tier is enough)
- Node.js 18+
- `npm install -g wrangler` (or use `npx wrangler`)
- A Telegram bot created via [@BotFather](https://t.me/BotFather) — save the bot token
- Your own Telegram numeric user ID (message [@userinfobot](https://t.me/userinfobot) to get it)

## 2. Deploy the Worker (backend + bot)

```bash
cd worker
npm install
wrangler login

# Create the D1 database and paste the resulting database_id into wrangler.toml
wrangler d1 create kys-fund-db

# Load the schema
npm run db:init:remote

# Set secrets (you'll be prompted to paste each value)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any random string you make up

# Deploy
npm run deploy
```

Note the Worker URL printed at the end, e.g. `https://kys-fund-worker.<you>.workers.dev`.

### Seed yourself as the owner admin

```bash
wrangler d1 execute kys-fund-db --remote --command \
  "INSERT INTO admins (telegram_id, name, role) VALUES ('<YOUR_TELEGRAM_ID>', '<YOUR_NAME>', 'owner');"
```

### Register the Telegram webhook

```bash
curl -F "url=https://<your-worker>.workers.dev/telegram/webhook" \
     -F "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

### Enable the daily reminder cron

Cron triggers are already declared in `wrangler.toml` (`[triggers]`). They
activate automatically on `wrangler deploy` — no extra step needed.

## 3. Deploy the frontend (Mini App)

```bash
cd frontend
npm install
cp .env.example .env
# edit .env — set VITE_API_BASE to your deployed Worker URL

npm run build
wrangler pages deploy dist --project-name=kys-fund
```

Note the Pages URL, e.g. `https://kys-fund.pages.dev`.

Update `MINI_APP_URL` in `worker/src/bot.ts` to this URL, then redeploy the
Worker (`npm run deploy` in `worker/`) so the bot's "Open Fund App" button
points at the right place.

## 4. Register the Mini App with BotFather

In BotFather:
1. `/mybots` → select your bot → **Bot Settings** → **Menu Button** → **Configure Menu Button**
2. Paste your Pages URL (e.g. `https://kys-fund.pages.dev`)

Now members can open the app directly from the bot's menu button, or via the
"Open Fund App" button the bot sends on `/start`.

## 5. Add members

Each person needs a row in the `members` table before they can submit
payments. Add them via the Mini App (Members → Add member) once you're set
up as the owner admin, or directly:

```bash
wrangler d1 execute kys-fund-db --remote --command \
  "INSERT INTO members (name, phone, monthly_amount) VALUES ('Ahmed Shifau', '777-1234', 250);"
```

When that member sends their first slip photo (or types `/start`) to the
bot, their Telegram account auto-links to their member record by matching
name — no manual step needed on their end.

## How payments work

1. Member sends a photo of their bank transfer slip to the bot, captioned
   `amount ref_number [YYYY-MM] [note]` (all optional except amount — OCR
   fills in gaps automatically via Workers AI vision).
2. Bot notifies all admins with Approve/Reject buttons.
3. On approval, the payment is recorded, the member is notified, and it
   shows up in the Mini App's Activity feed and Reports.

## Admin-only actions (via bot, captioned photos)

- **Log an expense with a receipt**: send a photo captioned `/expense Description [YYYY-MM]`

Everything else (add/edit members, log donations without a slip, settings,
reports, audit log) is done inside the Mini App.

## Free tier notes

- **Workers**: 100,000 requests/day — comfortably enough for a society-sized fund
- **D1**: 5 GB storage, 25M row reads/day free — far more than needed here
- **Workers AI**: has a free daily neuron allowance; OCR usage here is light (one call per slip)
- **Pages**: unlimited static requests, 500 builds/month free

Slip and receipt photos aren't re-stored anywhere — Telegram keeps them, and
the bot just saves the `file_id` reference, so there's no storage cost or
extra service to manage for that.

## Extending this later

- Recurring roles beyond Owner/Treasurer
- PDF export formatting for AGM handouts
- Multi-fund/multi-society support (would need a `fund_id` on every table)
