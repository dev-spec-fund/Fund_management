import type { Env } from "./types";
import { sendMessage, answerCallback, editMessageText, slipReference, ocrSlip, downloadTelegramFile } from "./telegram";
import { currentMonth, getAdminByTelegramId, logAudit, ensureMemberLinked, generateTxnId } from "./db";

const MINI_APP_URL = "https://fund-management.pages.de"; // replace with your deployed Mini App URL

/** Parses a caption like "250 BLAZ104172570689 2026-08 note here" */
function parseCaption(caption: string): { amount: number | null; ref: string | null; month: string | null; note: string | null } {
  const parts = caption.trim().split(/\s+/);
  const amount = parts[0] && !isNaN(Number(parts[0])) ? Number(parts.shift()) : null;
  const ref = parts[0] || null;
  if (ref) parts.shift();
  const monthMatch = parts.find((p) => /^\d{4}-\d{2}$/.test(p));
  const month = monthMatch || null;
  if (monthMatch) parts.splice(parts.indexOf(monthMatch), 1);
  const note = parts.length ? parts.join(" ") : null;
  return { amount, ref, month, note };
}

async function notifyAdmins(env: Env, text: string, extra: Record<string, unknown> = {}) {
  const admins = await env.DB.prepare("SELECT telegram_id FROM admins").all<{ telegram_id: string }>();
  for (const a of admins.results) {
    await sendMessage(env, a.telegram_id, text, extra);
  }
}

export async function handleUpdate(env: Env, update: any) {
  if (update.message) return handleMessage(env, update.message);
  if (update.callback_query) return handleCallback(env, update.callback_query);
}

async function handleMessage(env: Env, message: any) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");

  // Photo = payment slip submission
  if (message.photo) {
    return handleSlipPhoto(env, message, chatId, telegramId, displayName);
  }

  const text: string = message.text || "";

  if (text === "/start") {
    await ensureMemberLinked(env, telegramId, displayName);
    return sendMessage(env, chatId,
      `Welcome to the fund bot! 👋\n\nSend a photo of your bank transfer slip to submit your monthly contribution.\nCaption format: <code>amount ref_number [YYYY-MM] [note]</code>\n\nUse /mybalance to check your status, /history for past payments.`,
      { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: MINI_APP_URL } }]] } }
    );
  }

  if (text === "/mybalance") {
    const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin.");
    const month = currentMonth();
    const paid = await env.DB.prepare(
      "SELECT * FROM contributions WHERE member_id = ? AND month = ? AND status = 'approved'"
    ).bind(member.id, month).first();
    return sendMessage(env, chatId,
      `Member ID: ${member.member_code}\n` +
      (paid
        ? `✅ You're paid for ${month}.`
        : `⏳ No approved contribution found for ${month}. Monthly amount: MVR ${member.monthly_amount}.`)
    );
  }

  if (text === "/history") {
    const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin.");
    const rows = await env.DB.prepare(
      "SELECT txn_id, month, amount, status FROM contributions WHERE member_id = ? ORDER BY month DESC LIMIT 12"
    ).bind(member.id).all<any>();
    if (!rows.results.length) return sendMessage(env, chatId, "No contribution history yet.");
    const lines = rows.results.map((r) => `${r.txn_id} · ${r.month} — MVR ${r.amount} (${r.status})`);
    return sendMessage(env, chatId, lines.join("\n"));
  }

  // Admin-only: log an expense via caption command, or reply with a receipt photo
  if (text.startsWith("/expense ")) {
    return sendMessage(env, chatId, "To log an expense, send a receipt photo captioned:\n<code>/expense Description [YYYY-MM]</code>");
  }

  return sendMessage(env, chatId, "Send a payment slip photo to submit a contribution, or use /mybalance, /history.");
}

async function handleSlipPhoto(env: Env, message: any, chatId: number, telegramId: string, displayName: string) {
  const caption: string = message.caption || "";
  const largestPhoto = message.photo[message.photo.length - 1];
  const fileId = largestPhoto.file_id;

  // Admin logging an expense via receipt photo
  if (caption.startsWith("/expense")) {
    const admin = await getAdminByTelegramId(env, telegramId);
    if (!admin) return sendMessage(env, chatId, "Only admins can log expenses this way.");
    const rest = caption.replace("/expense", "").trim();
    const monthMatch = rest.match(/\d{4}-\d{2}/);
    const description = monthMatch ? rest.replace(monthMatch[0], "").trim() : rest;

    const file = await downloadTelegramFile(env, fileId);
    const ocr = file ? await ocrSlip(env, file.bytes) : { amount: null, ref: null, raw: "" };
    const receiptKey = slipReference(fileId);

    const txnId = await generateTxnId(env, "E");
    await env.DB.prepare(
      "INSERT INTO expenses (txn_id, description, amount, receipt_file_id, logged_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(txnId, description || "Expense", ocr.amount || 0, receiptKey, admin.id).run();

    await logAudit(env, admin.id, "log_expense", `${txnId} — ${description} — MVR ${ocr.amount ?? "?"}`);
    return sendMessage(env, chatId, `Expense logged (${txnId}): ${description}${ocr.amount ? ` — MVR ${ocr.amount}` : " (amount unclear, edit in app)"}`);
  }

  // Otherwise: treat as a member contribution slip
  const parsed = parseCaption(caption);
  const file = await downloadTelegramFile(env, fileId);
  const ocr = file ? await ocrSlip(env, file.bytes) : { amount: null, ref: null, raw: "" };

  const amount = parsed.amount ?? ocr.amount;
  const ref = parsed.ref ?? ocr.ref;
  const month = parsed.month ?? currentMonth();

  if (!amount) {
    return sendMessage(env, chatId, "Couldn't read the amount from your slip or caption. Please resend with caption: <code>amount ref_number [YYYY-MM]</code>");
  }

  let member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
  if (!member) {
    const linkedId = await ensureMemberLinked(env, telegramId, displayName);
    if (!linkedId) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin to be added first.");
    member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(linkedId).first<any>();
  }
  if (!member.active) {
    return sendMessage(env, chatId, "Your membership is currently inactive. Contact an admin if this is unexpected.");
  }

  // duplicate ref check
  let dupWarning = "";
  if (ref) {
    const dup = await env.DB.prepare(
      "SELECT id FROM contributions WHERE ref_number = ? AND status != 'rejected'"
    ).bind(ref).first();
    if (dup) dupWarning = "\n⚠️ This reference number was already submitted before.";
  }

  const slipKey = slipReference(fileId);

  const txnId = await generateTxnId(env, "C");
  const insertRes = await env.DB.prepare(
    "INSERT INTO contributions (txn_id, member_id, amount, month, ref_number, slip_file_id, ocr_raw) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(txnId, member.id, amount, month, ref, slipKey, ocr.raw).run();

  const contributionId = insertRes.meta.last_row_id;

  await sendMessage(env, chatId, `Slip received (${txnId}): MVR ${amount} for ${month}${ref ? ` (bank ref: ${ref})` : ""}. Waiting for admin approval.${dupWarning}`);

  await notifyAdmins(env,
    `🧾 New slip from <b>${member.name}</b> (${member.member_code})\nTxn: ${txnId}\nAmount: MVR ${amount}\nMonth: ${month}\nBank ref: ${ref || "not provided"}${dupWarning}`,
    {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${contributionId}` },
          { text: "❌ Reject", callback_data: `reject:${contributionId}` },
        ]],
      },
    }
  );
}

async function handleCallback(env: Env, callback: any) {
  const telegramId = String(callback.from.id);
  const admin = await getAdminByTelegramId(env, telegramId);
  if (!admin) return answerCallback(env, callback.id, "Admins only.");

  const [action, idStr] = callback.data.split(":");
  const contributionId = Number(idStr);

  const contribution = await env.DB.prepare("SELECT * FROM contributions WHERE id = ?").bind(contributionId).first<any>();
  if (!contribution) return answerCallback(env, callback.id, "Not found.");

  if (action === "approve") {
    await env.DB.prepare(
      "UPDATE contributions SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?"
    ).bind(admin.id, contributionId).run();
    await logAudit(env, admin.id, "approve_payment", `Contribution #${contributionId} approved`);

    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
    if (member?.telegram_id) {
      await sendMessage(env, member.telegram_id, `✅ Your MVR ${contribution.amount} contribution for ${contribution.month} was approved. Thank you!`);
    }
    await editMessageText(env, callback.message.chat.id, callback.message.message_id, `${callback.message.text}\n\n✅ Approved by ${admin.name}`);
    return answerCallback(env, callback.id, "Approved");
  }

  if (action === "reject") {
    await env.DB.prepare("UPDATE contributions SET status = 'rejected' WHERE id = ?").bind(contributionId).run();
    await logAudit(env, admin.id, "reject_payment", `Contribution #${contributionId} rejected`);

    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
    if (member?.telegram_id) {
      await sendMessage(env, member.telegram_id, `❌ Your slip for ${contribution.month} was rejected. Please check the amount/reference and resend.`);
    }
    await editMessageText(env, callback.message.chat.id, callback.message.message_id, `${callback.message.text}\n\n❌ Rejected by ${admin.name}`);
    return answerCallback(env, callback.id, "Rejected");
  }
}
