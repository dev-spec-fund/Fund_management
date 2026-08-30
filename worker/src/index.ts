import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";
import { telegramAuth } from "./auth";
import { handleUpdate } from "./bot";
import { runScheduled } from "./scheduled";
import { membersRoute } from "./routes/members";
import { expensesRoute } from "./routes/expenses";
import { donationsRoute } from "./routes/donations";
import { reportsRoute } from "./routes/reports";
import { settingsRoute } from "./routes/settings";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

// Telegram webhook — verified via secret token header set at registration time
app.post("/telegram/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) return c.text("Forbidden", 403);
  const update = await c.req.json();
  c.executionCtx.waitUntil(handleUpdate(c.env, update));
  return c.text("ok");
});

// Mini App API — all routes require verified Telegram initData
app.use("/api/*", telegramAuth);
app.route("/api/members", membersRoute);
app.route("/api/expenses", expensesRoute);
app.route("/api/donations", donationsRoute);
app.route("/api/reports", reportsRoute);
app.route("/api/settings", settingsRoute);

app.get("/api/me", (c) => {
  return c.json({ user: c.get("telegramUser"), admin: c.get("admin") });
});

app.get("/", (c) => c.text("KYS Fund Worker — see /telegram/webhook and /api/*"));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
};
