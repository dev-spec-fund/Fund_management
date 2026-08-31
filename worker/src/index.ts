import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Env } from "./types";
import { telegramAuth } from "./auth";
import { handleUpdate } from "./bot";
import { runScheduled } from "./scheduled";
import { membersRoute } from "./routes/members";
import { expensesRoute } from "./routes/expenses";
import { donationsRoute } from "./routes/donations";
import { reportsRoute } from "./routes/reports";
import { settingsRoute } from "./routes/settings";
import { adminRoute } from "./routes/admin";
import { ensureOperationalSchema, safeLogError } from "./ops";

const app = new Hono<AppEnv>();

app.use("/api/*", cors({
  origin: ["https://fund-management.pages.dev", "http://localhost:5173", "http://127.0.0.1:5173"],
  allowHeaders: ["Content-Type", "X-Telegram-Init-Data"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 86400,
}));

app.onError(async (err, c) => {
  await safeLogError(c.env, `http:${c.req.method}:${c.req.path}`, err);
  return c.json({ error: "Internal server error" }, 500);
});

// Telegram webhook — verified via secret token header set at registration time
app.post("/telegram/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.TELEGRAM_WEBHOOK_SECRET) return c.text("Forbidden", 403);
  const update = await c.req.json();
  c.executionCtx.waitUntil(handleUpdate(c.env, update).catch((e) => safeLogError(c.env, "telegram.update", e, { update_id: update?.update_id })));
  return c.text("ok");
});

// Mini App API — all routes require verified Telegram initData
app.use("/api/*", telegramAuth);
app.use("/api/*", async (c, next) => {
  await ensureOperationalSchema(c.env);
  const user=c.get("telegramUser");
  const { consumeRateLimit } = await import("./ops");
  if (!(await consumeRateLimit(c.env, "api", String(user?.id || "unknown"), 120, 60))) return c.json({error:"Too many requests"},429);
  await next();
});
app.route("/api/members", membersRoute);
app.route("/api/expenses", expensesRoute);
app.route("/api/donations", donationsRoute);
app.route("/api/reports", reportsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/admin", adminRoute);

app.get("/api/me", async (c) => {
  await ensureOperationalSchema(c.env);
  const user = c.get("telegramUser");
  const member = await c.env.DB.prepare(
    "SELECT id, member_code, telegram_id, name, phone, monthly_amount, active, joined_at, created_at FROM members WHERE telegram_id = ? LIMIT 1"
  ).bind(String(user.id)).first();
  return c.json({ user, admin: c.get("admin"), member: member || null });
});

// The signed-in member's own contribution history. This is intentionally
// separate from the admin member-detail route so dual-role users can switch
// to My Account without losing admin permissions.
app.get("/api/me/contributions", async (c) => {
  const user = c.get("telegramUser");
  const member = await c.env.DB.prepare(
    "SELECT id FROM members WHERE telegram_id = ? LIMIT 1"
  ).bind(String(user.id)).first<{ id: number }>();
  if (!member) return c.json({ error: "Member account not linked" }, 404);

  const rows = await c.env.DB.prepare(`
    SELECT id, txn_id, amount, month, ref_number, status, submitted_at, approved_at
    FROM contributions
    WHERE member_id = ?
    ORDER BY month DESC, submitted_at DESC
  `).bind(member.id).all();
  return c.json(rows.results);
});

app.get("/", (c) => c.text("KYS Fund Worker — see /telegram/webhook and /api/*"));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
};
