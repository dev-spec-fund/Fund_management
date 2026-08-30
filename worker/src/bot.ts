import type { Env } from "./types";
import {
  sendMessage,
  sendPhoto,
  answerCallback,
  editMessageText,
  editMessageCaption,
  slipReference,
  ocrSlip,
  downloadTelegramFile,
} from "./telegram";
import {
  currentMonth,
  getAdminByTelegramId,
  logAudit,
  ensureMemberLinked,
  generateTxnId,
  generateMemberCode,
  getSetting,
  createMemberRegistrationRequest,
  ensureMemberRegistrationTable,
  findUnlinkedMemberMatches,
} from "./db";

const MINI_APP_URL = "https://fund-management.pages.dev";

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Supported examples:
 * 250
 * 250 2026-08
 * 250 BLAZ104172570689
 * 250 BLAZ104172570689 2026-08 note here
 */
function parseCaption(caption: string): {
  amount: number | null;
  ref: string | null;
  month: string | null;
  note: string | null;
} {
  const parts = caption.trim().split(/\s+/).filter(Boolean);
  let amount: number | null = null;
  if (parts[0] && Number.isFinite(Number(parts[0]))) amount = Number(parts.shift());

  let month: string | null = null;
  const monthIndex = parts.findIndex((p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p));
  if (monthIndex >= 0) month = parts.splice(monthIndex, 1)[0];

  // A month immediately after the amount is not a bank reference.
  let ref: string | null = null;
  if (parts[0]) ref = parts.shift() || null;

  const note = parts.length ? parts.join(" ") : null;
  return { amount, ref, month, note };
}

async function notifyAdmins(env: Env, text: string, extra: Record<string, unknown> = {}) {
  const admins = await env.DB.prepare("SELECT telegram_id FROM admins").all<{ telegram_id: string }>();
  for (const a of admins.results) await sendMessage(env, a.telegram_id, text, extra);
}

async function notifyAdminsWithPhoto(
  env: Env,
  photoFileId: string,
  caption: string,
  extra: Record<string, unknown> = {}
) {
  const admins = await env.DB.prepare("SELECT telegram_id FROM admins").all<{ telegram_id: string }>();
  for (const a of admins.results) await sendPhoto(env, a.telegram_id, photoFileId, caption, extra);
}

function registrationButtons(requestId: number, matches: any[]) {
  const rows: any[][] = [];
  for (const m of matches) {
    rows.push([{ text: `🔗 Link ${m.member_code} — ${String(m.name).slice(0, 24)}`, callback_data: `member_link:${requestId}:${m.id}` }]);
  }
  rows.push([{ text: "➕ Create New Member", callback_data: `member_create:${requestId}` }]);
  rows.push([{ text: "❌ Reject", callback_data: `member_reject:${requestId}` }]);
  return { inline_keyboard: rows };
}

export async function handleUpdate(env: Env, update: any) {
  if (update.message) return handleMessage(env, update.message);
  if (update.callback_query) return handleCallback(env, update.callback_query);
}

async function handleMessage(env: Env, message: any) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");

  if (message.photo) return handleSlipPhoto(env, message, chatId, telegramId);

  const text: string = message.text || "";

  if (text === "/start") {
    const linkedId = await ensureMemberLinked(env, telegramId);
    if (linkedId) {
      return sendMessage(
        env,
        chatId,
        `Welcome to the fund bot! 👋\n\nSend a photo of your bank transfer slip to submit your monthly contribution.\nCaption examples:\n<code>250 2026-08</code>\n<code>250 BANKREF123 2026-08</code>\n\nUse /mybalance to check your status, /history for past payments.`,
        { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: MINI_APP_URL } }]] } }
      );
    }

    const currentAdmin = await getAdminByTelegramId(env, telegramId);
    if (currentAdmin) {
      return sendMessage(
        env,
        chatId,
        `👤 You are signed in as an administrator, but this Telegram account is not registered as a fund member yet.\n\nRegister yourself as a member to keep your own contribution history while retaining admin access.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ Register Myself as Member", callback_data: "self_register_member" }],
              [{ text: "Open Fund App", web_app: { url: MINI_APP_URL } }],
            ],
          },
        }
      );
    }

    const username = message.from.username ? String(message.from.username) : null;
    const request = await createMemberRegistrationRequest(env, telegramId, displayName || "Telegram User", username);

    if (request.status === "approved") {
      const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
      if (member) {
        return sendMessage(env, chatId, `✅ You are registered as ${esc(member.member_code)}.`, {
          reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: MINI_APP_URL } }]] },
        });
      }
    }

    if (request.created) {
      const matches = await findUnlinkedMemberMatches(env, displayName || "Telegram User");
      const usernameLine = username ? `\nUsername: @${esc(username)}` : "";
      const matchLine = matches.length
        ? `\n\n<b>Possible existing member${matches.length > 1 ? "s" : ""} found:</b>\n${matches.map((m: any) => `${esc(m.member_code)} — ${esc(m.name)}`).join("\n")}`
        : "\n\nNo exact unlinked member match was found.";
      await notifyAdmins(
        env,
        `👤 <b>New member registration request</b>\n\nName: <b>${esc(displayName || "Telegram User")}</b>${usernameLine}\nTelegram ID: <code>${esc(telegramId)}</code>${matchLine}\n\nChoose whether to link an existing member, create a new member, or reject.`,
        { reply_markup: registrationButtons(request.id, matches) }
      );
    }

    return sendMessage(
      env,
      chatId,
      request.created
        ? "👋 Your registration request has been sent to the fund admin. You will be notified after it is reviewed."
        : "⏳ Your membership registration request is still waiting for admin approval."
    );
  }

  if (text === "/mybalance") {
    const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin.");
    const month = currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
    const paid = await env.DB.prepare(
      "SELECT * FROM contributions WHERE member_id = ? AND month = ? AND status = 'approved'"
    ).bind(member.id, month).first();
    return sendMessage(
      env,
      chatId,
      `Member ID: ${esc(member.member_code)}\n` +
        (paid
          ? `✅ You're paid for ${month}.`
          : `⏳ No approved contribution found for ${month}. Monthly amount: MVR ${member.monthly_amount}.`)
    );
  }

  if (text === "/history") {
    const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin.");
    const rows = await env.DB.prepare(
      "SELECT txn_id, month, amount, status FROM contributions WHERE member_id = ? ORDER BY submitted_at DESC LIMIT 12"
    ).bind(member.id).all<any>();
    if (!rows.results.length) return sendMessage(env, chatId, "No contribution history yet.");
    const lines = rows.results.map((r: any) => `${esc(r.txn_id)} · ${r.month} — MVR ${r.amount} (${r.status})`);
    return sendMessage(env, chatId, lines.join("\n"));
  }

  if (text.startsWith("/expense ")) {
    return sendMessage(env, chatId, "To log an expense, send a receipt photo captioned:\n<code>/expense Description [YYYY-MM]</code>");
  }

  return sendMessage(env, chatId, "Send a payment slip photo to submit a contribution, or use /mybalance, /history.");
}

async function handleSlipPhoto(env: Env, message: any, chatId: number, telegramId: string) {
  const caption: string = message.caption || "";
  const largestPhoto = message.photo[message.photo.length - 1];
  const fileId = largestPhoto.file_id;

  if (caption.startsWith("/expense")) {
    const admin = await getAdminByTelegramId(env, telegramId);
    if (!admin) return sendMessage(env, chatId, "Only admins can log expenses this way.");
    const rest = caption.replace("/expense", "").trim();
    const monthMatch = rest.match(/\d{4}-(0[1-9]|1[0-2])/);
    const description = monthMatch ? rest.replace(monthMatch[0], "").trim() : rest;

    const file = await downloadTelegramFile(env, fileId);
    const ocr = file ? await ocrSlip(env, file.bytes) : { amount: null, ref: null, raw: "" };
    const txnId = await generateTxnId(env, "E");
    await env.DB.prepare(
      "INSERT INTO expenses (txn_id, description, amount, receipt_file_id, logged_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(txnId, description || "Expense", ocr.amount || 0, slipReference(fileId), admin.id).run();
    await logAudit(env, admin.id, "log_expense", `${txnId} — ${description} — MVR ${ocr.amount ?? "?"}`);
    return sendMessage(env, chatId, `Expense logged (${txnId}): ${esc(description || "Expense")}${ocr.amount ? ` — MVR ${ocr.amount}` : " (amount unclear, edit in app)"}`);
  }

  const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
  if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Use /start to request registration.");
  if (!member.active) return sendMessage(env, chatId, "Your membership is currently inactive. Contact an admin if this is unexpected.");

  const parsed = parseCaption(caption);
  const file = await downloadTelegramFile(env, fileId);
  const ocr = file ? await ocrSlip(env, file.bytes) : { amount: null, ref: null, raw: "" };
  const amount = parsed.amount ?? ocr.amount;
  const ref = parsed.ref ?? ocr.ref;
  const month = parsed.month ?? currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");

  if (!amount || amount <= 0) {
    return sendMessage(env, chatId, "Couldn't read the amount from your slip. Please resend with a caption such as <code>250 2026-08</code> or <code>250 BANKREF123 2026-08</code>.");
  }

  let dupWarning = "";
  if (ref) {
    const dup = await env.DB.prepare(
      "SELECT id FROM contributions WHERE ref_number = ? AND status != 'rejected'"
    ).bind(ref).first();
    if (dup) dupWarning = "\n⚠️ This bank reference was already submitted before.";
  }

  const txnId = await generateTxnId(env, "C");
  const insertRes = await env.DB.prepare(
    "INSERT INTO contributions (txn_id, member_id, amount, month, ref_number, slip_file_id, ocr_raw) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(txnId, member.id, amount, month, ref, slipReference(fileId), ocr.raw).run();
  const contributionId = Number(insertRes.meta.last_row_id);

  await sendMessage(env, chatId, `Slip received (${txnId}): MVR ${amount} for ${month}${ref ? ` (bank ref: ${esc(ref)})` : ""}. Waiting for admin approval.${dupWarning}`);

  const adminCaption =
    `🧾 <b>New contribution slip</b>\n\n` +
    `Member: <b>${esc(member.name)}</b> (${esc(member.member_code)})\n` +
    `Txn: <code>${txnId}</code>\n` +
    `Amount: <b>MVR ${amount}</b>\n` +
    `Month: ${month}\n` +
    `Bank ref: <code>${esc(ref || "not detected")}</code>${dupWarning}`;

  await notifyAdminsWithPhoto(env, fileId, adminCaption, {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Approve", callback_data: `approve:${contributionId}` },
        { text: "❌ Reject", callback_data: `reject:${contributionId}` },
      ]],
    },
  });
}

async function finishRegistrationMessage(env: Env, callback: any, text: string) {
  if (callback.message?.photo) {
    return editMessageCaption(env, callback.message.chat.id, callback.message.message_id, text);
  }
  return editMessageText(env, callback.message.chat.id, callback.message.message_id, text);
}

async function handleCallback(env: Env, callback: any) {
  const telegramId = String(callback.from.id);
  const admin = await getAdminByTelegramId(env, telegramId);
  if (!admin) return answerCallback(env, callback.id, "Admins only.");

  const data = String(callback.data || "");
  const parts = data.split(":");
  const action = parts[0];

  if (action === "self_register_member") {
    let member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) {
      const memberCode = await generateMemberCode(env);
      const defaultMonthly = Number(await getSetting(env, "default_monthly_amount")) || 250;
      const displayName = [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" ") || admin.name;
      const insert = await env.DB.prepare(
        "INSERT INTO members (member_code, telegram_id, name, monthly_amount) VALUES (?, ?, ?, ?)"
      ).bind(memberCode, telegramId, displayName, defaultMonthly).run();
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(insert.meta.last_row_id).first<any>();
      await logAudit(env, admin.id, "self_register_admin_as_member", `${member.member_code} — ${member.name}`);
    }
    await finishRegistrationMessage(env, callback, `✅ Registered as fund member ${esc(member.member_code)}.\n\nYour administrator access is unchanged. You can use My Account in the Fund App for your own contributions.`);
    return answerCallback(env, callback.id, `Registered as ${member.member_code}`);
  }

  if (action === "member_create" || action === "member_link" || action === "member_reject" || action === "member_approve") {
    await ensureMemberRegistrationTable(env);
    const requestId = Number(parts[1]);
    const request = await env.DB.prepare("SELECT * FROM member_registration_requests WHERE id = ?").bind(requestId).first<any>();
    if (!request) return answerCallback(env, callback.id, "Registration request not found.");
    if (request.status !== "pending") return answerCallback(env, callback.id, `Already ${request.status}.`);

    if (action === "member_reject") {
      const changed = await env.DB.prepare(
        "UPDATE member_registration_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'"
      ).bind(admin.id, requestId).run();
      if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
      await logAudit(env, admin.id, "reject_member_registration", `${request.name} (${request.telegram_id})`);
      await sendMessage(env, request.telegram_id, "❌ Your membership registration request was rejected. You can use /start later to submit a new request.");
      await finishRegistrationMessage(env, callback, `${callback.message.caption || callback.message.text}\n\n❌ Rejected by ${esc(admin.name)}`);
      return answerCallback(env, callback.id, "Registration rejected");
    }

    let member: any = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(request.telegram_id).first<any>();

    if (!member && action === "member_link") {
      const memberId = Number(parts[2]);
      const target = await env.DB.prepare("SELECT * FROM members WHERE id = ? AND telegram_id IS NULL").bind(memberId).first<any>();
      if (!target) return answerCallback(env, callback.id, "That member is already linked or no longer available.");
      const linked = await env.DB.prepare(
        "UPDATE members SET telegram_id = ? WHERE id = ? AND telegram_id IS NULL"
      ).bind(request.telegram_id, memberId).run();
      if (!linked.meta.changes) return answerCallback(env, callback.id, "Could not link that member.");
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first<any>();
    }

    if (!member) {
      const memberCode = await generateMemberCode(env);
      const defaultMonthly = Number(await getSetting(env, "default_monthly_amount")) || 250;
      const insert = await env.DB.prepare(
        "INSERT INTO members (member_code, telegram_id, name, monthly_amount) VALUES (?, ?, ?, ?)"
      ).bind(memberCode, request.telegram_id, request.name, defaultMonthly).run();
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(insert.meta.last_row_id).first<any>();
    }

    const reviewed = await env.DB.prepare(
      "UPDATE member_registration_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).bind(admin.id, requestId).run();
    if (!reviewed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");

    await logAudit(env, admin.id, action === "member_link" ? "link_member_registration" : "approve_member_registration", `${member.member_code} — ${member.name} (${request.telegram_id})`);
    await sendMessage(
      env,
      request.telegram_id,
      `✅ Your membership has been approved!\n\nMember ID: <b>${esc(member.member_code)}</b>\nName: ${esc(member.name)}\n\nYou can now submit contribution slips and use the Fund App.`,
      { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: MINI_APP_URL } }]] } }
    );
    await finishRegistrationMessage(env, callback, `${callback.message.caption || callback.message.text}\n\n✅ Approved by ${esc(admin.name)}\nMember ID: ${esc(member.member_code)}`);
    return answerCallback(env, callback.id, `Registered as ${member.member_code}`);
  }

  if (action !== "approve" && action !== "reject") return answerCallback(env, callback.id, "Unknown action.");

  const contributionId = Number(parts[1]);
  const contribution = await env.DB.prepare("SELECT * FROM contributions WHERE id = ?").bind(contributionId).first<any>();
  if (!contribution) return answerCallback(env, callback.id, "Not found.");
  if (contribution.status !== "pending") return answerCallback(env, callback.id, `Already ${contribution.status}.`);

  if (action === "approve") {
    const changed = await env.DB.prepare(
      "UPDATE contributions SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).bind(admin.id, contributionId).run();
    if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
    await logAudit(env, admin.id, "approve_payment", `${contribution.txn_id} approved`);
    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
    if (member?.telegram_id) await sendMessage(env, member.telegram_id, `✅ Your MVR ${contribution.amount} contribution for ${contribution.month} was approved. Thank you!`);
    const previous = callback.message.caption || callback.message.text || "Contribution";
    await finishRegistrationMessage(env, callback, `${previous}\n\n✅ Approved by ${esc(admin.name)}`);
    return answerCallback(env, callback.id, "Approved");
  }

  const changed = await env.DB.prepare(
    "UPDATE contributions SET status = 'rejected', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).bind(admin.id, contributionId).run();
  if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
  await logAudit(env, admin.id, "reject_payment", `${contribution.txn_id} rejected`);
  const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
  if (member?.telegram_id) await sendMessage(env, member.telegram_id, `❌ Your slip for ${contribution.month} was rejected. Please check the amount/reference and resend.`);
  const previous = callback.message.caption || callback.message.text || "Contribution";
  await finishRegistrationMessage(env, callback, `${previous}\n\n❌ Rejected by ${esc(admin.name)}`);
  return answerCallback(env, callback.id, "Rejected");
}
