import type { Env } from "../types";
import { paidForMonth } from "../allocations";
import { contributionRateForMonth } from "../contributionRates";
import { sendMessage } from "../telegram";
import { currentMonth, ensureMemberLinked, getAdminByTelegramId, getBranding, createMemberRegistrationRequest, ensureMemberRegistrationTable } from "../db";
import { consumeRateLimit, normalizePhone } from "../ops";
import { esc, miniAppUrl, notifyRegistrationRequest, sharePhoneKeyboard } from "../botSupport";
import { handleSlipPhoto } from "./slips";

export async function handleMessage(env: Env, message: any) {
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

