import type { Env } from "./types";
import { approveWithAllocations, allocationReceipt, paidForMonth } from "./allocations";
import { contributionRateForMonth, ensureInitialContributionRate } from "./contributionRates";
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
  getBranding,
  createMemberRegistrationRequest,
  ensureMemberRegistrationTable,
} from "./db";
import { adminCan, consumeRateLimit, contributionDuplicateKey, duplicateSlip, normalizeName, normalizePhone, requireOpenMonth, safeLogError } from "./ops";

import { esc, miniAppUrl, notifyAdmins, notifyAdminsWithPhoto, notifyRegistrationRequest, parseCaption, sharePhoneKeyboard } from "./botSupport";

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

  if (message.contact) {
    if (!(await consumeRateLimit(env, "bot_registration_phone", telegramId, 5, 60))) {
      return sendMessage(env, chatId, "Too many requests. Please try again in a minute.");
    }
    const contact = message.contact;
    if (String(contact.user_id || "") !== telegramId) {
      return sendMessage(env, chatId, "Please use the Share phone number button so I receive your own Telegram phone number.");
    }
    const phone = normalizePhone(contact.phone_number);
    if (!phone) return sendMessage(env, chatId, "I could not read that phone number. Please try sharing it again.");

    await ensureMemberRegistrationTable(env);
    const username = message.from.username ? String(message.from.username) : null;
    let request = await env.DB.prepare("SELECT * FROM member_registration_requests WHERE telegram_id = ?")
      .bind(telegramId).first<any>();
    if (!request || request.status === "rejected") {
      await createMemberRegistrationRequest(env, telegramId, displayName || "Telegram User", username);
      request = await env.DB.prepare("SELECT * FROM member_registration_requests WHERE telegram_id = ?")
        .bind(telegramId).first<any>();
    }
    if (request?.status === "approved") {
      return sendMessage(env, chatId, "✅ Your membership is already approved.", { reply_markup: { remove_keyboard: true } });
    }

    await env.DB.prepare(`
      UPDATE member_registration_requests
      SET name = ?, username = ?, phone = ?, status = 'pending'
      WHERE telegram_id = ? AND status != 'approved'
    `).bind(displayName || request?.name || "Telegram User", username, phone, telegramId).run();
    request = await env.DB.prepare("SELECT * FROM member_registration_requests WHERE telegram_id = ?")
      .bind(telegramId).first<any>();

    await notifyRegistrationRequest(env, request);
    return sendMessage(
      env,
      chatId,
      `✅ Phone number received: <b>${esc(phone)}</b>\n\nYour registration request has been sent to the fund admin. You will be notified after it is reviewed.`,
      { reply_markup: { remove_keyboard: true } }
    );
  }

  if (message.photo) return handleSlipPhoto(env, message, chatId, telegramId);

  const text: string = message.text || "";

  if (text === "/start") {
    if (!(await consumeRateLimit(env, "bot_start", telegramId, 5, 60))) return sendMessage(env, chatId, "Too many requests. Please try again in a minute.");
    const linkedId = await ensureMemberLinked(env, telegramId);
    if (linkedId) {
      return sendMessage(
        env,
        chatId,
        `Welcome to <b>${(await getBranding(env)).fund_name}</b>! 👋\n\nSend your bank transfer slip photo — no caption is needed. I will automatically read the amount, bank reference and transaction date, then send it for admin review.\n\nUse /mybalance to check your status, /history for past payments.`,
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

    if (!request.phone) {
      return sendMessage(
        env,
        chatId,
        "👋 To request fund membership, please share the phone number connected to your Telegram account.\n\nTap <b>📱 Share phone number</b> below. Your request will be sent to the admins after you share it.",
        { reply_markup: sharePhoneKeyboard() }
      );
    }

    if (request.status === "awaiting_phone") {
      await env.DB.prepare("UPDATE member_registration_requests SET status='pending' WHERE id=?").bind(request.id).run();
      const ready = await env.DB.prepare("SELECT * FROM member_registration_requests WHERE id=?").bind(request.id).first<any>();
      await notifyRegistrationRequest(env, ready);
    }

    return sendMessage(env, chatId, "⏳ Your membership registration request is waiting for admin approval.", { reply_markup: { remove_keyboard: true } });
  }

  if (text === "/mybalance") {
    const member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) return sendMessage(env, chatId, "You're not registered as a member yet. Contact an admin.");
    const month = currentMonth(env.FUND_TIMEZONE || "Indian/Maldives");
    const paid = await paidForMonth(env, member.id, month);
    const rate = await contributionRateForMonth(env, member.id, month, Number(member.monthly_amount||0));
    const exemption = await env.DB.prepare("SELECT reason FROM exemptions WHERE member_id=? AND month=?").bind(member.id,month).first<any>();
    const due = exemption ? 0 : Math.max(0, rate-paid);
    const status = exemption ? `✅ Exempt for ${month}.` : paid<=0 ? `⏳ Unpaid for ${month}. Due: MVR ${rate.toFixed(2)}.` : due>0.004 ? `🟡 Partial for ${month}: MVR ${paid.toFixed(2)} paid, MVR ${due.toFixed(2)} due.` : `✅ Paid for ${month}.`;
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
    const txnId = await generateTxnId(env, "E");
    const r = await env.DB.prepare(`INSERT INTO expenses
      (txn_id, description, amount, receipt_file_id, logged_by, transaction_month, status, approved_by, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(txnId, description || "Expense", amount, slipReference(fileId), admin.id, month, "approved", admin.id, new Date().toISOString()).run();
    const expenseId = Number(r.meta.last_row_id);
    await logAudit(env, admin.id, "expense_created", `${txnId} — ${description || "Expense"} — MVR ${amount} — approved`);
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
  let insertRes:any;
  try {
    insertRes = await env.DB.prepare(
      "INSERT INTO contributions (txn_id, member_id, amount, month, ref_number, bank_date, duplicate_key, slip_file_id, ocr_raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(txnId, member.id, amount, month, ref, bankDate, contributionDuplicateKey(ref,Number(amount),bankDate), slipReference(fileId), ocr.raw).run();
  } catch (e:any) {
    const raced = await duplicateSlip(env, ref, Number(amount), bankDate);
    if (raced) return sendMessage(env, chatId, `⚠️ This slip appears to be a duplicate of <code>${esc(raced.txn_id)}</code>. It was not submitted again.`);
    throw e;
  }
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

async function renderMeetingRsvp(env: Env, callback: any, meeting: any, response: string | null, showOptions = false) {
  const chatId=callback.message?.chat?.id;
  const messageId=callback.message?.message_id;
  if(!chatId || !messageId) return;
  const label=response==="yes"?"✅ Going":response==="maybe"?"❔ Maybe":response==="no"?"❌ Not attending":"⏳ Awaiting response";
  const venue=meeting.venue?`\nVenue: <b>${esc(meeting.venue)}</b>`:"";
  const agenda=meeting.agenda?`\n\n${esc(meeting.agenda)}`:"";
  const branding=await getBranding(env);
  const text=`📅 <b>${esc(branding.fund_name)} · Meeting invitation</b>\n\n<b>${esc(meeting.title)}</b>\n${esc(meeting.meeting_date)} · ${esc(meeting.meeting_time)}${venue}${agenda}\n\nYour response: <b>${label}</b>`;
  const rows:any[][]=[];
  if(showOptions){
    rows.push([
      {text:'✅ Yes',callback_data:`meeting_rsvp:${meeting.id}:yes`},
      {text:'❔ Maybe',callback_data:`meeting_rsvp:${meeting.id}:maybe`},
      {text:'❌ No',callback_data:`meeting_rsvp:${meeting.id}:no`}
    ]);
    if(response) rows.push([{text:'↩ Undo RSVP',callback_data:`meeting_rsvp_undo:${meeting.id}`}]);
  } else if(response){
    rows.push([
      {text:'↩ Undo RSVP',callback_data:`meeting_rsvp_undo:${meeting.id}`},
      {text:'Show options',callback_data:`meeting_rsvp_show:${meeting.id}`}
    ]);
  } else {
    rows.push([{text:'Show RSVP options',callback_data:`meeting_rsvp_show:${meeting.id}`}]);
  }
  await editMessageText(env,chatId,messageId,text,{parse_mode:'HTML',reply_markup:{inline_keyboard:rows}});
}

async function handleCallback(env: Env, callback: any) {
  const telegramId = String(callback.from.id);
  if (!(await consumeRateLimit(env, "bot_callback", telegramId, 30, 60))) return answerCallback(env, callback.id, "Too many actions. Try again shortly.");

  const data = String(callback.data || "");
  const parts = data.split(":");
  const action = parts[0];

  // RSVP actions are member actions, not admin-only actions.
  if (action === "meeting_rsvp" || action === "meeting_rsvp_show" || action === "meeting_rsvp_undo") {
    const meetingId=Number(parts[1]);
    const member=await env.DB.prepare("SELECT * FROM members WHERE telegram_id=? AND active=1").bind(telegramId).first<any>();
    if(!member) return answerCallback(env,callback.id,"Your Telegram account is not linked to an active member.");
    const meeting=await env.DB.prepare("SELECT * FROM meetings WHERE id=?").bind(meetingId).first<any>();
    if(!meeting) return answerCallback(env,callback.id,"Meeting not found.");
    if(meeting.status==="cancelled") return answerCallback(env,callback.id,"This meeting has been cancelled.");
    const existing=await env.DB.prepare("SELECT response FROM meeting_rsvps WHERE meeting_id=? AND member_id=?").bind(meetingId,member.id).first<any>();

    if(action === "meeting_rsvp_show"){
      await renderMeetingRsvp(env,callback,meeting,existing?.response||null,true);
      return answerCallback(env,callback.id,"Choose your RSVP.");
    }
    if(action === "meeting_rsvp_undo"){
      await env.DB.prepare("DELETE FROM meeting_rsvps WHERE meeting_id=? AND member_id=?").bind(meetingId,member.id).run();
      await renderMeetingRsvp(env,callback,meeting,null,true);
      return answerCallback(env,callback.id,"RSVP removed.");
    }

    const response=String(parts[2]||"");
    if(!["yes","maybe","no"].includes(response)) return answerCallback(env,callback.id,"Invalid RSVP.");
    await env.DB.prepare(`INSERT INTO meeting_rsvps(meeting_id,member_id,response,responded_at) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(meeting_id,member_id) DO UPDATE SET response=excluded.response,responded_at=datetime('now')`)
      .bind(meetingId,member.id,response).run();
    const label=response==="yes"?"Going":response==="maybe"?"Maybe":"Not attending";
    await renderMeetingRsvp(env,callback,meeting,response,false);
    return answerCallback(env,callback.id,`RSVP saved: ${label}`);
  }

  const admin = await getAdminByTelegramId(env, telegramId);
  if (!admin) return answerCallback(env, callback.id, "Admins only.");

  if (action === "self_register_member") {
    let member = await env.DB.prepare("SELECT * FROM members WHERE telegram_id = ?").bind(telegramId).first<any>();
    if (!member) {
      const memberCode = await generateMemberCode(env);
      const defaultMonthly = Number(await getSetting(env, "default_monthly_amount")) || 250;
      const displayName = [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" ") || admin.name;
      const insert = await env.DB.prepare(
        "INSERT INTO members (member_code, telegram_id, name, monthly_amount, normalized_name, normalized_phone) VALUES (?, ?, ?, ?, ?, NULL)"
      ).bind(memberCode, telegramId, displayName, defaultMonthly, normalizeName(displayName)).run();
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(insert.meta.last_row_id).first<any>();
      await ensureInitialContributionRate(env,Number(insert.meta.last_row_id),defaultMonthly,currentMonth(env.FUND_TIMEZONE || "Indian/Maldives"));
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
        "UPDATE members SET telegram_id = ?, phone = COALESCE(NULLIF(?,''), phone), normalized_phone = CASE WHEN NULLIF(?,'') IS NOT NULL THEN ? ELSE normalized_phone END WHERE id = ? AND telegram_id IS NULL"
      ).bind(request.telegram_id, request.phone || null, request.phone || null, normalizePhone(request.phone) || null, memberId).run();
      if (!linked.meta.changes) return answerCallback(env, callback.id, "Could not link that member.");
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first<any>();
    }

    if (!member) {
      const memberCode = await generateMemberCode(env);
      const defaultMonthly = Number(await getSetting(env, "default_monthly_amount")) || 250;
      const insert = await env.DB.prepare(
        "INSERT INTO members (member_code, telegram_id, name, phone, monthly_amount, normalized_name, normalized_phone) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(memberCode, request.telegram_id, request.name, request.phone || null, defaultMonthly, normalizeName(request.name), normalizePhone(request.phone) || null).run();
      member = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(insert.meta.last_row_id).first<any>();
      await ensureInitialContributionRate(env,Number(insert.meta.last_row_id),defaultMonthly,currentMonth(env.FUND_TIMEZONE || "Indian/Maldives"));
    }

    const reviewed = await env.DB.prepare(
      "UPDATE member_registration_requests SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'"
    ).bind(admin.id, requestId).run();
    if (!reviewed.meta.changes) return answerCallback(env, callback.id, "Already reviewed.");

    await logAudit(env, admin.id, action === "member_link" ? "member_linked" : "member_registration_approved", `${member.member_code} — ${member.name} (${request.telegram_id})`);
    await sendMessage(
      env,
      request.telegram_id,
      `✅ Your membership with <b>${(await getBranding(env)).fund_name}</b> has been approved!\n\nMember ID: <b>${esc(member.member_code)}</b>\nName: ${esc(member.name)}${member.phone ? `\nPhone: ${esc(member.phone)}` : ""}\n\nYou can now submit contribution slips and use the Fund App.`,
      { reply_markup: { inline_keyboard: [[{ text: "Open Fund App", web_app: { url: await miniAppUrl(env) } }]] } }
    );
    await finishRegistrationMessage(env, callback, `${callback.message.caption || callback.message.text}\n\n✅ Approved by ${esc(admin.name)}\nMember ID: ${esc(member.member_code)}`);
    return answerCallback(env, callback.id, `Registered as ${member.member_code}`);
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
