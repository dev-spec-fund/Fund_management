# Fund Management Bot

Telegram fund management bot built with [grammY](https://grammy.dev/) on
Cloudflare Workers (webhook mode) + Cloudflare D1 for storage.

## Structure

- `index.ts` — worker entrypoint + all bot logic
- `schema.sql` — D1 database schema (subscribers, payments, expenses)
- `wrangler.toml` — Workers/D1 configuration
- `preview.html` — standalone mock UI preview (no backend calls)

## Deploy

```bash
npm install
wrangler login

# 1. Create the D1 database, then paste the returned database_id
#    into wrangler.toml
wrangler d1 create fund-management-db

# 2. Apply the schema
npm run db:apply

# 3. Set secrets
wrangler secret put BOT_TOKEN
wrangler secret put ADMIN_ID
wrangler secret put OCR_API_KEY

# 4. Deploy
npm run deploy

# 5. Point Telegram at your worker
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<YOUR_WORKER_URL>"
```

## Local dev

```bash
npm run dev
```

## Logs

```bash
npm run tail
```
