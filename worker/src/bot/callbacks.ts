import type { Env } from "../types";
import { approveWithAllocations, allocationReceipt } from "../allocations";
import { ensureInitialContributionRate } from "../contributionRates";
import { sendMessage, answerCallback, editMessageText, editMessageCaption } from "../telegram";
import { currentMonth, currentDate, getAdminByTelegramId, logAudit, generateMemberCode, getSetting, getBranding, ensureMemberRegistrationTable } from "../db";
import { adminCan, consumeRateLimit, duplicateSlip, normalizeName, normalizePhone, requireOpenMonth } from "../ops";
import { esc, miniAppUrl } from "../botSupport";

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

export async function handleCallback(env: Env, callback: any) {
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
        "INSERT INTO members (member_code, telegram_id, name, monthly_amount, normalized_name, normalized_phone, joined_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
      ).bind(memberCode, telegramId, displayName, defaultMonthly, normalizeName(displayName), currentDate(env.FUND_TIMEZONE || "Indian/Maldives")).run();
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
        "INSERT INTO members (member_code, telegram_id, name, phone, monthly_amount, normalized_name, normalized_phone, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(memberCode, request.telegram_id, request.name, request.phone || null, defaultMonthly, normalizeName(request.name), normalizePhone(request.phone) || null, currentDate(env.FUND_TIMEZONE || "Indian/Maldives")).run();
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
