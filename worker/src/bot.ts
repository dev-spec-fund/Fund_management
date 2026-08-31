import type { Env } from "./types";
import { approveWithAllocations, allocationReceipt, paidForMonth } from "./allocations";
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
import { adminCan, consumeRateLimit, duplicateSlip, requireOpenMonth, safeLogError } from "./ops";

const DEFAULT_MINI_APP_URL = "https://fund-management.pages.dev";
let cachedMiniAppUrl: { value: string; expiresAt: number } | null = null;
async function miniAppUrl(env: Env) {
  if (cachedMiniAppUrl && cachedMiniAppUrl.expiresAt > Date.now()) return cachedMiniAppUrl.value;
  const value = (await getSetting(env, "mini_app_url")) || DEFAULT_MINI_APP_URL;
  cachedMiniAppUrl = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

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
  const admins = await env.DB.prepare("SELECT telegram_id FROM admins WHERE COALESCE(active,1)=1 AND telegram_id IS NOT NULL AND trim(telegram_id) != '' AND lower(trim(role)) IN ('owner','super_admin','treasurer')").all<{ telegram_id: string }>();
  await Promise.allSettled(admins.results.map((a) => sendMessage(env, a.telegram_id, text, extra)));
}

async function notifyAdminsWithPhoto(
  env: Env,
  photoFileId: string,
  caption: string,
  extra: Record<string, unknown> = {}
) {
  const admins = await env.DB.prepare("SELECT telegram_id FROM admins WHERE COALESCE(active,1)=1 AND telegram_id IS NOT NULL AND trim(telegram_id) != '' AND lower(trim(role)) IN ('owner','super_admin','treasurer')").all<{ telegram_id: string }>();
  await Promise.allSettled(admins.results.map((a) => sendPhoto(env, a.telegram_id, photoFileId, caption, extra)));
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
  try {
    if (update.message) return handleMessage(env, update.message);
    if (update.callback_query) return handleCallback(env, update.callback_query);
  } catch (e) {
    await safeLogError(env, "bot.handleUpdate", e, { update_id: update?.update_id });
    throw e;
  }
}

async function handleMessage(env: Env, message: any) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);
  const displayName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");

  if (message.photo) return handleSlipPhoto(env, message, chatId, telegramId);

  const text: string = message.text || "";

  if (text === "/start") {
    if (!(await consumeRateLimit(env, "bot_start", telegramId, 5, 60))) return sendMessage(env, chatId, "Too many requests. Please try again in a minute.");
    const linkedId = await ensureMemberLinked(env, telegramId);
    if (linkedId) {
      return sendMessage(
        env,
        chatId,
        `Welcome to the fund bot! 👋\n\nSend your bank transfer slip photo — no caption is needed. I will automatically read the amount, bank reference and transaction date, then send it for admin review.\n\nUse /mybalance to check your status, /history for past payments.`,
        { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: await miniAppUrl(env) } }]] } }
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
              [{ text: "Open Fund App", web_app: { url: await miniAppUrl(env) } }],
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
          reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: await miniAppUrl(env) } }]] },
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
    const paidRow = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount),0) total FROM contributions WHERE member_id = ? AND month = ? AND status = 'approved'"
    ).bind(member.id, month).first<any>();
    const exemption = await env.DB.prepare("SELECT reason FROM exemptions WHERE member_id=? AND month=?").bind(member.id,month).first<any>();
    const paid = Number(paidTotal || 0); const due = Math.max(0, Number(member.monthly_amount)-paid);
    const status = exemption ? `✅ Exempt for ${month}.` : paid<=0 ? `⏳ Unpaid for ${month}. Due: MVR ${member.monthly_amount}.` : due>0.004 ? `🟡 Partial for ${month}: MVR ${paid} paid, MVR ${due.toFixed(2)} due.` : `✅ Paid for ${month}.`;
    return sendMessage(env, chatId, `Member ID: ${esc(member.member_code)}\n${status}`);
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

  return sendMessage(env, chatId, "Send your bank transfer slip photo — no caption is needed. I will read the amount and bank reference automatically. You can also use /mybalance or /history.");
}

async function handleSlipPhoto(env: Env, message: any, chatId: number, telegramId: string) {
  if (!(await consumeRateLimit(env, "slip_upload", telegramId, 10, 3600))) return sendMessage(env, chatId, "Too many slip uploads. Please try again later.");
  const caption: string = message.caption || "";
  const largestPhoto = message.photo[message.photo.length - 1];
  const fileId = largestPhoto.file_id;
  // Use a smaller Telegram-generated photo for OCR when available. The original
  // file_id is still kept/sent to admins, so review image quality is unchanged.
  const ocrPhoto = [...message.photo].reverse().find((p: any) => Math.max(Number(p.width || 0), Number(p.height || 0)) <= 1280) || largestPhoto;
  const ocrFileId = ocrPhoto.file_id;

  if (caption.startsWith("/expense")) {
    const admin = await getAdminByTelegramId(env, telegramId);
    if (!admin || !adminCan(admin, "finance")) return sendMessage(env, chatId, "Treasurer or Super Admin access is required to log expenses.");
    const rest = caption.replace("/expense", "").trim();
    const monthMatch = rest.match(/\d{4}-(0[1-9]|1[0-2])/);
    const month = monthMatch?.[0] || currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
    const description = monthMatch ? rest.replace(monthMatch[0], "").trim() : rest;
    try { await requireOpenMonth(env, month); } catch (e:any) { return sendMessage(env, chatId, esc(e.message)); }

    const file = await downloadTelegramFile(env, ocrFileId);
    const ocr = file ? await ocrSlip(env, file.bytes, file.mime) : { amount: null, ref: null, raw: "" };
    const amount = Number(ocr.amount || 0);
    if (amount <= 0) return sendMessage(env, chatId, "I couldn't read the expense amount. Please add/edit this expense in the Fund App.");
    const threshold = Number(await getSetting(env, "expense_approval_threshold")) || 5000;
    const approvers = await env.DB.prepare("SELECT COUNT(*) n FROM admins WHERE id != ? AND COALESCE(active,1)=1 AND role IN ('owner','super_admin','treasurer')").bind(admin.id).first<{n:number}>();
    const needsApproval = amount >= threshold && Number(approvers?.n || 0) > 0;
    const txnId = await generateTxnId(env, "E");
    const r = await env.DB.prepare(`INSERT INTO expenses
      (txn_id, description, amount, receipt_file_id, logged_by, transaction_month, status, approval_required, approved_by, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(txnId, description || "Expense", amount, slipReference(fileId), admin.id, month, needsApproval ? "pending" : "approved", needsApproval ? 1 : 0, needsApproval ? null : admin.id, needsApproval ? null : new Date().toISOString()).run();
    const expenseId = Number(r.meta.last_row_id);
    await logAudit(env, admin.id, "expense_created", `${txnId} — ${description || "Expense"} — MVR ${amount} — ${needsApproval ? "pending approval" : "approved"}`);
    if (needsApproval) {
      const captionText = `🧾 <b>Expense confirmation required</b>

Txn: <code>${txnId}</code>
Description: ${esc(description || "Expense")}
Amount: <b>MVR ${amount}</b>
Month: ${month}
Logged by: ${esc(admin.name)}`;
      const admins = await env.DB.prepare("SELECT telegram_id,id FROM admins WHERE id != ? AND COALESCE(active,1)=1 AND telegram_id IS NOT NULL AND trim(telegram_id) != '' AND lower(trim(role)) IN ('owner','super_admin','treasurer')").bind(admin.id).all<any>();
      await Promise.allSettled(admins.results.map((a) => sendPhoto(env, a.telegram_id, fileId, captionText, { reply_markup: { inline_keyboard: [[
        { text: "✅ Confirm expense", callback_data: `expapprove:${expenseId}` },
        { text: "❌ Reject expense", callback_data: `expreject:${expenseId}` },
      ]] } })));
      return sendMessage(env, chatId, `Expense ${txnId} saved as pending. A different admin must confirm it because it is MVR ${amount}.`);
    }
    return sendMessage(env, chatId, `Expense logged (${txnId}): ${esc(description || "Expense")} — MVR ${amount}`);
  }

  const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
  if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Use /start to request registration.");
  if (!member.active) return sendMessage(env, chatId, "Your membership is currently inactive. Contact an admin if this is unexpected.");

  // Member contributions are image-first: no caption is required or trusted.
  // Always OCR the slip itself so amount/reference come from the bank image.
  let ocr: { amount: number | null; ref: string | null; raw: string } = { amount: null, ref: null, raw: "" };
  const file = await downloadTelegramFile(env, ocrFileId);
  if (!file) return sendMessage(env, chatId, "I couldn't download that slip image. Please resend the photo.");
  ocr = await ocrSlip(env, file.bytes, file.mime);

  const amount = ocr.amount;
  const ref = ocr.ref;
  const month = currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
  let extractedDate: string | null = null;
  try {
    const structured = JSON.parse(ocr.raw || "{}");
    if (typeof structured?.date === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(structured.date)) extractedDate = structured.date;
  } catch {}
  const bankDate = extractedDate || new Intl.DateTimeFormat("en-CA", {
    timeZone: env.FUND_TIMEZONE || "Indian/Maldives", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  if (!amount || amount <= 0) {
    return sendMessage(env, chatId, "⚠️ I couldn't read the payment amount from this slip. Please resend a clearer/full slip image. No caption is needed.");
  }

  try { await requireOpenMonth(env, month); } catch (e:any) { return sendMessage(env, chatId, `This contribution month is closed: ${esc(e.message)}`); }
  const dup = await duplicateSlip(env, ref, Number(amount), bankDate);
  if (dup) {
    await logAudit(env, null, "duplicate_slip_blocked", JSON.stringify({
      member_id: member.id,
      member_code: member.member_code,
      amount: Number(amount),
      month,
      ref: ref || null,
      bank_date: bankDate,
      existing_txn_id: dup.txn_id,
    }));
    return sendMessage(env, chatId, `⚠️ This slip appears to be a duplicate of <code>${esc(dup.txn_id)}</code> (same bank reference, amount and date). It was not submitted again.`);
  }
  const dupWarning = "";

  const txnId = await generateTxnId(env, "C");
  const insertRes = await env.DB.prepare(
    "INSERT INTO contributions (txn_id, member_id, amount, month, ref_number, bank_date, slip_file_id, ocr_raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(txnId, member.id, amount, month, ref, bankDate, slipReference(fileId), ocr.raw).run();
  const contributionId = Number(insertRes.meta.last_row_id);

  await sendMessage(env, chatId,
    `✅ Slip received (${txnId})\nAmount: MVR ${amount}\nBank reference: ${ref ? `<code>${esc(ref)}</code>` : "not detected — admin will review"}\nMonth: ${month}\n\nWaiting for admin approval.`
  );

  const adminCaption =
    `🧾 <b>New contribution slip</b>\n\n` +
    `Member: <b>${esc(member.name)}</b> (${esc(member.member_code)})\n` +
    `Txn: <code>${txnId}</code>\n` +
    `Amount: <b>MVR ${amount}</b>\n` +
    `Month: ${month}\n` +
    `Bank ref: <code>${esc(ref || "not detected")}</code>\n` +
    `Bank date: ${esc(bankDate)}\n` +
    `${ref ? "✅ OCR amount/reference detected" : "⚠️ OCR reference needs admin review"}${dupWarning}`;

  await notifyAdminsWithPhoto(env, fileId, adminCaption, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `approve:${contributionId}` },
          { text: "❌ Reject", callback_data: `reject:${contributionId}` },
        ],
        [{ text: "✏️ Review / Correct OCR", web_app: { url: `${await miniAppUrl(env)}?review=contribution&id=${contributionId}` } }]
      ],
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
  if (!(await consumeRateLimit(env, "bot_callback", telegramId, 30, 60))) return answerCallback(env, callback.id, "Too many actions. Try again shortly.");
  const admin = await getAdminByTelegramId(env, telegramId);
  if (!admin) return answerCallback(env, callback.id, "Admins only.");

  const data = String(callback.data || "");
  const parts = data.split(":");
  const action = parts[0];

  if (action === "meeting_rsvp") {
    const meetingId=Number(parts[1]);
    const response=String(parts[2]||"");
    if(!["yes","maybe","no"].includes(response)) return answerCallback(env,callback.id,"Invalid RSVP.");
    const member=await env.DB.prepare("SELECT * FROM members WHERE telegram_id=? AND active=1").bind(telegramId).first<any>();
    if(!member) return answerCallback(env,callback.id,"Your Telegram account is not linked to an active member.");
    const meeting=await env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(meetingId).first<any>();
    if(!meeting) return answerCallback(env,callback.id,"Meeting not found.");
    await env.DB.prepare(`INSERT INTO meeting_rsvps(meeting_id,member_id,response,responded_at) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(meeting_id,member_id) DO UPDATE SET response=excluded.response,responded_at=datetime('now')`)
      .bind(meetingId,member.id,response).run();
    const label=response==="yes"?"Going":response==="maybe"?"Maybe":"Not attending";
    await answerCallback(env,callback.id,`RSVP saved: ${label}`);
    return;
  }

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
    if (!adminCan(admin, "finance")) return answerCallback(env, callback.id, "Treasurer or Super Admin required.");
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

    await logAudit(env, admin.id, action === "member_link" ? "member_linked" : "member_registration_approved", `${member.member_code} — ${member.name} (${request.telegram_id})`);
    await sendMessage(
      env,
      request.telegram_id,
      `✅ Your membership has been approved!\n\nMember ID: <b>${esc(member.member_code)}</b>\nName: ${esc(member.name)}\n\nYou can now submit contribution slips and use the Fund App.`,
      { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: await miniAppUrl(env) } }]] } }
    );
    await finishRegistrationMessage(env, callback, `${callback.message.caption || callback.message.text}\n\n✅ Approved by ${esc(admin.name)}\nMember ID: ${esc(member.member_code)}`);
    return answerCallback(env, callback.id, `Registered as ${member.member_code}`);
  }

  if (action === "expapprove" || action === "expreject") {
    if (!adminCan(admin, "finance")) return answerCallback(env, callback.id, "Treasurer or Super Admin required.");
    const expenseId = Number(parts[1]);
    const expense = await env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(expenseId).first<any>();
    if (!expense) return answerCallback(env, callback.id, "Expense not found.");
    if (expense.status !== "pending") return answerCallback(env, callback.id, `Already ${expense.status}.`);
    if (action === "expapprove" && Number(expense.logged_by) === Number(admin.id)) return answerCallback(env, callback.id, "A different admin must confirm this expense.");
    try { await requireOpenMonth(env, expense.transaction_month || expense.created_at.slice(0,7)); } catch (e:any) { return answerCallback(env, callback.id, e.message); }
    if (action === "expapprove") {
      const changed = await env.DB.prepare("UPDATE expenses SET status='approved',approved_by=?,approved_at=datetime('now') WHERE id=? AND status='pending'").bind(admin.id,expenseId).run();
      if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
      await logAudit(env, admin.id, "expense_approved", `${expense.txn_id} approved`);
      const previous = callback.message.caption || callback.message.text || "Expense";
      await finishRegistrationMessage(env, callback, `${previous}

✅ Confirmed by ${esc(admin.name)}`);
      return answerCallback(env, callback.id, "Expense confirmed");
    }
    const changed = await env.DB.prepare("UPDATE expenses SET status='voided',voided_by=?,voided_at=datetime('now'),void_reason='Rejected during approval' WHERE id=? AND status='pending'").bind(admin.id,expenseId).run();
    if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
    await logAudit(env, admin.id, "expense_rejected", `${expense.txn_id} rejected`);
    const previous = callback.message.caption || callback.message.text || "Expense";
    await finishRegistrationMessage(env, callback, `${previous}

❌ Rejected by ${esc(admin.name)}`);
    return answerCallback(env, callback.id, "Expense rejected");
  }

  if (action !== "approve" && action !== "reject") return answerCallback(env, callback.id, "Unknown action.");
  if (!adminCan(admin, "finance")) return answerCallback(env, callback.id, "Treasurer or Super Admin required.");

  const contributionId = Number(parts[1]);
  const contribution = await env.DB.prepare("SELECT * FROM contributions WHERE id = ?").bind(contributionId).first<any>();
  if (!contribution) return answerCallback(env, callback.id, "Not found.");
  if (contribution.status !== "pending") return answerCallback(env, callback.id, `Already ${contribution.status}.`);

  if (action === "approve") {
    try { await requireOpenMonth(env, contribution.month); } catch (e:any) { return answerCallback(env, callback.id, e.message); }
    const duplicate = await duplicateSlip(env, contribution.ref_number, Number(contribution.amount), contribution.bank_date, contributionId);
    if (duplicate) return answerCallback(env, callback.id, `Duplicate of ${duplicate.txn_id}; review in app.`);
    let approved;
    try { approved=await approveWithAllocations(env,contributionId,admin.id); }
    catch(e:any){ return answerCallback(env,callback.id,e.message); }
    await logAudit(env, admin.id, "contribution_approved", `${contribution.txn_id} approved — ${approved.allocations.map((a:any)=>`${a.month}:${a.amount}`).join(", ")}`);
    const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
    if (member?.telegram_id) await sendMessage(env, member.telegram_id,
      `✅ <b>Contribution approved</b>\n\nReceived: <b>MVR ${Number(contribution.amount).toFixed(2)}</b>\n\nApplied to:\n${allocationReceipt(approved.allocations)}`
    );
    const previous = callback.message.caption || callback.message.text || "Contribution";
    await finishRegistrationMessage(env, callback, `${previous}\n\n✅ Approved by ${esc(admin.name)}`);
    return answerCallback(env, callback.id, "Approved");
  }

  const changed = await env.DB.prepare(
    "UPDATE contributions SET status = 'rejected', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).bind(admin.id, contributionId).run();
  if (!changed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");
  await logAudit(env, admin.id, "contribution_rejected", `${contribution.txn_id} rejected`);
  const member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(contribution.member_id).first<any>();
  if (member?.telegram_id) await sendMessage(env, member.telegram_id, `❌ Your slip for ${contribution.month} was rejected. Please check the amount/reference and resend.`);
  const previous = callback.message.caption || callback.message.text || "Contribution";
  await finishRegistrationMessage(env, callback, `${previous}\n\n❌ Rejected by ${esc(admin.name)}`);
  return answerCallback(env, callback.id, "Rejected");
}
