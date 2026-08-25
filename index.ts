/**
 * ============================================================================
 * Fund Management Bot — Cloudflare Workers Edge Runtime
 * ============================================================================
 * Stack: grammY (webhook mode) + Cloudflare D1 (SQLite) + OCR.space
 *
 * Design notes (Free Tier / 50ms CPU cap):
 * ----------------------------------------------------------------------------
 * 1. The fetch() handler parses the incoming Telegram update, hands the
 *    ENTIRE processing pipeline to `ctx.waitUntil()`, and returns a bare
 *    200 OK synchronously. Telegram never waits on our bot logic, database
 *    writes, or the OCR round-trip — all of that runs in the background
 *    after the response has already been flushed.
 * 2. No inline `await` chains block the returned Response. Every branch
 *    that talks to the Telegram Bot API, D1, or OCR.space is invoked from
 *    inside a waitUntil()-wrapped async function.
 * 3. Conversation state (multi-step flows like "enter amount" -> "upload
 *    receipt" -> "confirm reference") is persisted in a lightweight D1
 *    table (`user_state`) rather than in-memory, since Workers isolates
 *    are not guaranteed to survive between requests.
 * ============================================================================
 */

import { Bot, Context, InlineKeyboard } from "grammy";

// ============================================================================
// Types
// ============================================================================

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  ADMIN_ID: string;
  OCR_API_KEY: string;
}

type Step = "awaiting_amount" | "awaiting_receipt" | "awaiting_manual_ref" | "awaiting_expense";

interface StatePayload {
  amount?: number;
  ocrGuess?: string;
}

interface PaymentRow {
  id: number;
  subscriber_id: number;
  amount: number;
  reference_number: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  processed_at: string | null;
}

interface ExpenseRow {
  id: number;
  amount: number;
  description: string;
  incurred_at: string;
}

// ============================================================================
// Small helpers
// ============================================================================

const MVR = (n: number) => `MVR ${n.toFixed(2)}`;

function isAdmin(env: Env, telegramId: number): boolean {
  return String(telegramId) === String(env.ADMIN_ID);
}

function monthWindow(date = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Best-effort extraction of a bank transaction reference from raw OCR text. */
function extractReference(ocrText: string): string | null {
  const candidates = ocrText.match(/\b[A-Z0-9]{6,20}\b/gi) ?? [];
  if (candidates.length === 0) return null;
  // Heuristic: prefer tokens that contain at least one digit (refs are never
  // pure alphabetic words picked up from receipt boilerplate), then take the
  // longest surviving candidate.
  const withDigits = candidates.filter((c) => /\d/.test(c));
  const pool = withDigits.length > 0 ? withDigits : candidates;
  pool.sort((a, b) => b.length - a.length);
  return pool[0].toUpperCase();
}

// ============================================================================
// D1 conversation-state store
// ============================================================================

async function ensureStateTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_state (
         telegram_id INTEGER PRIMARY KEY,
         step        TEXT NOT NULL,
         payload     TEXT,
         updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       )`
    )
    .run();
}

async function setState(db: D1Database, telegramId: number, step: Step, payload: StatePayload = {}): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_state (telegram_id, step, payload, updated_at)
       VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(telegram_id) DO UPDATE SET step = excluded.step, payload = excluded.payload, updated_at = excluded.updated_at`
    )
    .bind(telegramId, step, JSON.stringify(payload))
    .run();
}

async function getState(db: D1Database, telegramId: number): Promise<{ step: Step; payload: StatePayload } | null> {
  const row = await db
    .prepare(`SELECT step, payload FROM user_state WHERE telegram_id = ?1`)
    .bind(telegramId)
    .first<{ step: Step; payload: string | null }>();
  if (!row) return null;
  return { step: row.step, payload: row.payload ? JSON.parse(row.payload) : {} };
}

async function clearState(db: D1Database, telegramId: number): Promise<void> {
  await db.prepare(`DELETE FROM user_state WHERE telegram_id = ?1`).bind(telegramId).run();
}

// ============================================================================
// UI: keyboards & menu rendering
// ============================================================================

function subscriberMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💰 Submit Payment", "menu:submit_payment")
    .row()
    .text("📈 View My Status", "menu:my_status")
    .row()
    .text("📜 My Payment History", "menu:my_history")
    .row()
    .text("📊 Fund & Expense Summary", "menu:fund_summary");
}

function adminMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Fund & Expense Summary", "menu:admin_summary")
    .row()
    .text("⏳ Pending Approvals", "menu:admin_pending")
    .row()
    .text("➕ Record Expense", "menu:admin_expense");
}

async function sendMainMenu(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from?.id;
  if (!id) return;
  if (isAdmin(env, id)) {
    await ctx.reply("👑 *Admin Dashboard*\nChoose an action:", {
      parse_mode: "Markdown",
      reply_markup: adminMenu(),
    });
  } else {
    await ctx.reply("👋 *Fund Dashboard*\nChoose an action:", {
      parse_mode: "Markdown",
      reply_markup: subscriberMenu(),
    });
  }
}

// ============================================================================
// Bot factory (built once per isolate, reused across requests)
// ============================================================================

let cachedBot: Bot<Context> | undefined;

function getBot(env: Env): Bot<Context> {
  if (cachedBot) return cachedBot;

  const bot = new Bot<Context>(env.BOT_TOKEN);

  // --------------------------------------------------------------------
  // /start — register subscriber, show role-based menu
  // --------------------------------------------------------------------
  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    await ensureStateTable(env.DB);
    await env.DB.prepare(
      `INSERT INTO subscribers (telegram_id, name, username, joined_at)
       VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, username = excluded.username`
    )
      .bind(from.id, `${from.first_name} ${from.last_name ?? ""}`.trim(), from.username ?? null)
      .run();
    await clearState(env.DB, from.id);
    await sendMainMenu(ctx, env);
  });

  // --------------------------------------------------------------------
  // Inline menu router
  // --------------------------------------------------------------------
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callback_query.data;
    const from = ctx.from;
    if (!from) return;
    await ctx.answerCallbackQuery(); // ack immediately, avoids client-side spinner

    if (data === "menu:submit_payment") return handleSubmitPaymentStart(ctx, env);
    if (data === "menu:my_status") return handleMyStatus(ctx, env);
    if (data === "menu:my_history") return handleMyHistory(ctx, env);
    // Fund & Expense Summary is read-only totals — visible to subscribers too,
    // so both menus route to the same handler (admin keeps its own button/copy).
    if (data === "menu:fund_summary" || data === "menu:admin_summary") return handleFundSummary(ctx, env);

    if (isAdmin(env, from.id)) {
      if (data === "menu:admin_pending") return handleAdminPending(ctx, env);
      if (data === "menu:admin_expense") return handleAdminExpenseStart(ctx, env);
      if (data.startsWith("approve:")) return handleApprove(ctx, env, Number(data.split(":")[1]));
      if (data.startsWith("reject:")) return handleReject(ctx, env, Number(data.split(":")[1]));
    }

    if (data === "ref:manual") return handleManualRefPrompt(ctx, env);
    if (data.startsWith("ref:confirm:")) {
      const ref = data.slice("ref:confirm:".length);
      return finalizePaymentSubmission(ctx, env, ref);
    }
  });

  // --------------------------------------------------------------------
  // Photo upload — receipt image for OCR pipeline
  // --------------------------------------------------------------------
  bot.on("message:photo", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const state = await getState(env.DB, from.id);
    if (!state || state.step !== "awaiting_receipt") {
      await ctx.reply("Tap 💰 Submit Payment first, then send your receipt photo.");
      return;
    }
    await runOcrPipeline(ctx, env, from.id, state.payload);
  });

  // --------------------------------------------------------------------
  // Plain text — routed by conversation step
  // --------------------------------------------------------------------
  bot.on("message:text", async (ctx) => {
    const from = ctx.from;
    const text = ctx.message.text.trim();
    if (!from || text.startsWith("/")) return;

    const state = await getState(env.DB, from.id);
    if (!state) return; // no active flow — ignore stray text

    switch (state.step) {
      case "awaiting_amount":
        return handleAmountInput(ctx, env, from.id, text);
      case "awaiting_manual_ref":
        return finalizePaymentSubmission(ctx, env, text.toUpperCase(), state.payload);
      case "awaiting_expense":
        if (isAdmin(env, from.id)) return handleExpenseInput(ctx, env, text);
        return;
      default:
        return;
    }
  });

  cachedBot = bot;
  return bot;
}

// ============================================================================
// Flow: Submit Payment (subscriber)
// ============================================================================

async function handleSubmitPaymentStart(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from!.id;
  await setState(env.DB, id, "awaiting_amount");
  await ctx.reply("💵 Enter the *amount* you paid (numbers only, e.g. `250` or `250.00`):", {
    parse_mode: "Markdown",
  });
}

async function handleAmountInput(ctx: Context, env: Env, telegramId: number, text: string): Promise<void> {
  const amount = Number(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    await ctx.reply("⚠️ That doesn't look like a valid amount. Try again, e.g. `250`.", { parse_mode: "Markdown" });
    return;
  }
  await setState(env.DB, telegramId, "awaiting_receipt", { amount });
  await ctx.reply("📸 Great — now send a *photo* of your transfer receipt/slip.", { parse_mode: "Markdown" });
}

async function handleManualRefPrompt(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from!.id;
  const state = await getState(env.DB, id);
  await setState(env.DB, id, "awaiting_manual_ref", state?.payload ?? {});
  await ctx.editMessageText("⌨️ Type the transaction reference number exactly as it appears on your slip:");
}

/**
 * OCR.space pipeline. Called from within the waitUntil()-wrapped update
 * handler, so it is free to take its time — the webhook response to
 * Telegram has already been sent.
 */
async function runOcrPipeline(ctx: Context, env: Env, telegramId: number, payload: StatePayload): Promise<void> {
  const processingMsg = await ctx.reply("🔎 Reading your receipt, one moment...");
  try {
    const photos = ctx.message?.photo;
    const largest = photos?.[photos.length - 1];
    if (!largest) throw new Error("no photo in update");

    // 1. Resolve Telegram file path -> public download URL
    const file = await ctx.api.getFile(largest.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;

    // 2. Hand the URL to OCR.space (free tier, URL-based parsing)
    const ocrUrl =
      `https://api.ocr.space/parse/imageurl` +
      `?apikey=${encodeURIComponent(env.OCR_API_KEY)}` +
      `&url=${encodeURIComponent(fileUrl)}` +
      `&OCREngine=2&scale=true`;

    const ocrResp = await fetch(ocrUrl);
    const ocrJson = await ocrResp.json<{
      ParsedResults?: { ParsedText: string }[];
      IsErroredOnProcessing?: boolean;
    }>();

    const rawText = ocrJson.ParsedResults?.[0]?.ParsedText ?? "";
    const guess = !ocrJson.IsErroredOnProcessing ? extractReference(rawText) : null;

    await ctx.api
      .deleteMessage(processingMsg.chat.id, processingMsg.message_id)
      .catch(() => undefined /* non-fatal */);

    if (guess) {
      await setState(env.DB, telegramId, "awaiting_receipt", { ...payload, ocrGuess: guess });
      await ctx.reply(`Is *${guess}* the correct reference number?`, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, Confirm", `ref:confirm:${guess}`)
          .text("✏️ No, Enter Manually", "ref:manual"),
      });
    } else {
      // Clean fallback to manual text capture
      await setState(env.DB, telegramId, "awaiting_manual_ref", payload);
      await ctx.reply(
        "🤖 I couldn't confidently read a reference number from that image.\n" +
          "Please type the transaction reference number manually:"
      );
    }
  } catch (err) {
    await ctx.api
      .deleteMessage(processingMsg.chat.id, processingMsg.message_id)
      .catch(() => undefined);
    await setState(env.DB, telegramId, "awaiting_manual_ref", payload);
    await ctx.reply(
      "⚠️ OCR is temporarily unavailable. Please type the transaction reference number manually:"
    );
  }
}

async function finalizePaymentSubmission(
  ctx: Context,
  env: Env,
  reference: string,
  payloadOverride?: StatePayload
): Promise<void> {
  const id = ctx.from!.id;
  const state = payloadOverride ?? (await getState(env.DB, id))?.payload;
  const amount = state?.amount;

  if (!amount) {
    await clearState(env.DB, id);
    await ctx.reply("Session expired — tap 💰 Submit Payment to start again.");
    return;
  }

  try {
    await env.DB.prepare(
      `INSERT INTO payments (subscriber_id, amount, reference_number, status, submitted_at)
       VALUES (?1, ?2, ?3, 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
      .bind(id, amount, reference)
      .run();
  } catch (err) {
    // UNIQUE constraint violation on reference_number => duplicate slip
    await clearState(env.DB, id);
    await ctx.reply(
      `🚫 *Duplicate reference detected.*\nReference \`${reference}\` has already been submitted. ` +
        `If you believe this is an error, contact the fund administrator.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  await clearState(env.DB, id);
  await ctx.reply(
    `✅ Payment submitted!\n\n*Amount:* ${MVR(amount)}\n*Reference:* \`${reference}\`\n*Status:* Pending admin approval`,
    { parse_mode: "Markdown" }
  );

  // Notify admin in the background — no need for the subscriber to wait on this
  await ctx.api
    .sendMessage(
      env.ADMIN_ID,
      `🔔 *New payment awaiting approval*\nFrom: ${ctx.from?.first_name ?? "Subscriber"} (${id})\n` +
        `Amount: ${MVR(amount)}\nReference: \`${reference}\`\n\nOpen ⏳ Pending Approvals to review.`,
      { parse_mode: "Markdown" }
    )
    .catch(() => undefined);
}

// ============================================================================
// Flow: Subscriber status & history
// ============================================================================

async function handleMyStatus(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from!.id;
  const { start, end } = monthWindow();
  const rows = await env.DB.prepare(
    `SELECT * FROM payments
     WHERE subscriber_id = ?1 AND submitted_at >= ?2 AND submitted_at < ?3
     ORDER BY submitted_at DESC`
  )
    .bind(id, start, end)
    .all<PaymentRow>();

  if (!rows.results || rows.results.length === 0) {
    await ctx.reply("📈 No payment recorded for the current month yet. Tap 💰 Submit Payment to add one.");
    return;
  }

  const lines = rows.results.map(
    (p) => `• ${MVR(p.amount)} — \`${p.reference_number}\` — ${statusEmoji(p.status)} ${p.status}`
  );
  await ctx.reply(`📈 *Your Status This Month*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
}

async function handleMyHistory(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from!.id;
  const rows = await env.DB.prepare(
    `SELECT * FROM payments
     WHERE subscriber_id = ?1 AND status IN ('approved', 'pending')
     ORDER BY submitted_at DESC LIMIT 25`
  )
    .bind(id)
    .all<PaymentRow>();

  if (!rows.results || rows.results.length === 0) {
    await ctx.reply("📜 No payment history yet.");
    return;
  }

  const lines = rows.results.map(
    (p) =>
      `${statusEmoji(p.status)} ${p.submitted_at.slice(0, 10)} — ${MVR(p.amount)} — \`${p.reference_number}\``
  );
  await ctx.reply(`📜 *Payment History*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
}

function statusEmoji(status: PaymentRow["status"]): string {
  return status === "approved" ? "✅" : status === "rejected" ? "❌" : "⏳";
}

// ============================================================================
// Flow: Fund & Expense Summary (read-only — subscribers AND admin)
// ============================================================================

async function handleFundSummary(ctx: Context, env: Env): Promise<void> {
  const [fundsRow, expensesRow, recentExpenses] = await Promise.all([
    env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'approved'`).first<{
      total: number;
    }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses`).first<{ total: number }>(),
    env.DB.prepare(`SELECT * FROM expenses ORDER BY incurred_at DESC LIMIT 5`).all<ExpenseRow>(),
  ]);

  const totalFunds = fundsRow?.total ?? 0;
  const totalExpenses = expensesRow?.total ?? 0;
  const net = totalFunds - totalExpenses;

  const ledger =
    recentExpenses.results && recentExpenses.results.length > 0
      ? recentExpenses.results
          .map((e) => `  • ${e.incurred_at.slice(0, 10)} — ${MVR(e.amount)} — ${e.description}`)
          .join("\n")
      : "  (no expenses recorded yet)";

  await ctx.reply(
    `📊 *Fund & Expense Summary*\n\n` +
      `💰 Total Funds Collected: *${MVR(totalFunds)}*\n` +
      `💸 Total Expenses Incurred: *${MVR(totalExpenses)}*\n` +
      `🏦 Net Available Balance: *${MVR(net)}*\n\n` +
      `🧾 *Recent Expenses:*\n${ledger}`,
    { parse_mode: "Markdown" }
  );
}

// ============================================================================
// Flow: Admin — Pending Approvals
// ============================================================================

async function handleAdminPending(ctx: Context, env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT p.*, s.name AS subscriber_name FROM payments p
     JOIN subscribers s ON s.telegram_id = p.subscriber_id
     WHERE p.status = 'pending'
     ORDER BY p.submitted_at ASC LIMIT 20`
  ).all<PaymentRow & { subscriber_name: string }>();

  if (!rows.results || rows.results.length === 0) {
    await ctx.reply("⏳ No pending approvals — you're all caught up!");
    return;
  }

  for (const p of rows.results) {
    await ctx.reply(
      `👤 *${p.subscriber_name}*\n💵 ${MVR(p.amount)}\n🔖 \`${p.reference_number}\`\n🕒 ${p.submitted_at.slice(0, 16).replace("T", " ")}`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("✅ Approve", `approve:${p.id}`).text("❌ Reject", `reject:${p.id}`),
      }
    );
  }
}

async function handleApprove(ctx: Context, env: Env, paymentId: number): Promise<void> {
  await setPaymentStatus(ctx, env, paymentId, "approved");
}

async function handleReject(ctx: Context, env: Env, paymentId: number): Promise<void> {
  await setPaymentStatus(ctx, env, paymentId, "rejected");
}

async function setPaymentStatus(
  ctx: Context,
  env: Env,
  paymentId: number,
  status: "approved" | "rejected"
): Promise<void> {
  const payment = await env.DB.prepare(`SELECT * FROM payments WHERE id = ?1`).bind(paymentId).first<PaymentRow>();
  if (!payment) {
    await ctx.editMessageText("⚠️ This payment record no longer exists.");
    return;
  }
  if (payment.status !== "pending") {
    await ctx.editMessageText(`ℹ️ Already ${payment.status} — no action taken.`);
    return;
  }

  await env.DB.prepare(
    `UPDATE payments SET status = ?1, processed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2`
  )
    .bind(status, paymentId)
    .run();

  const emoji = status === "approved" ? "✅" : "❌";
  await ctx.editMessageText(`${emoji} Payment \`${payment.reference_number}\` marked *${status}*.`, {
    parse_mode: "Markdown",
  });

  await ctx.api
    .sendMessage(
      payment.subscriber_id,
      `${emoji} Your payment of ${MVR(payment.amount)} (ref \`${payment.reference_number}\`) was *${status}*.`,
      { parse_mode: "Markdown" }
    )
    .catch(() => undefined);
}

// ============================================================================
// Flow: Admin — Record Expense
// ============================================================================

async function handleAdminExpenseStart(ctx: Context, env: Env): Promise<void> {
  const id = ctx.from!.id;
  await setState(env.DB, id, "awaiting_expense");
  await ctx.reply(
    "➕ Send the expense as: `<amount> <description>`\nExample: `150 Office supplies for June`",
    { parse_mode: "Markdown" }
  );
}

async function handleExpenseInput(ctx: Context, env: Env, text: string): Promise<void> {
  const id = ctx.from!.id;
  const match = text.match(/^([0-9]+(?:\.[0-9]{1,2})?)\s+(.+)$/);
  if (!match) {
    await ctx.reply("⚠️ Format not recognized. Send it as: `<amount> <description>`", { parse_mode: "Markdown" });
    return;
  }
  const amount = Number(match[1]);
  const description = match[2].trim();

  await env.DB.prepare(
    `INSERT INTO expenses (amount, description, incurred_at) VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  )
    .bind(amount, description)
    .run();

  await clearState(env.DB, id);
  await ctx.reply(`✅ Expense recorded: *${MVR(amount)}* — ${description}`, { parse_mode: "Markdown" });
}

// ============================================================================
// Worker entrypoint
// ============================================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Fund Management Bot is running.", { status: 200 });
    }

    let update: unknown;
    try {
      update = await request.json();
    } catch {
      // Malformed body — ack anyway so Telegram doesn't retry forever
      return new Response("OK", { status: 200 });
    }

    // Everything below this line is background work: Telegram already
    // gets its 200 OK before any of it runs, so it never touches the
    // 50ms synchronous CPU budget.
    ctx.waitUntil(
      (async () => {
        try {
          await ensureStateTable(env.DB);
          const bot = getBot(env);
          if (!bot.isInited()) await bot.init();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await bot.handleUpdate(update as any);
        } catch (err) {
          console.error("Update processing failed:", err);
        }
      })()
    );

    return new Response("OK", { status: 200 });
  },
};
