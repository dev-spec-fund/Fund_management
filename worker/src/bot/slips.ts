import type { Env } from "../types";
import { sendMessage, slipReference, ocrSlip, downloadTelegramFile } from "../telegram";
import { currentMonth, getAdminByTelegramId, logAudit, generateTxnId } from "../db";
import { adminCan, consumeRateLimit, contributionDuplicateKey, duplicateSlip, requireOpenMonth } from "../ops";
import { esc, miniAppUrl, notifyAdminsWithPhoto } from "../botSupport";

export async function handleSlipPhoto(env: Env, message: any, chatId: number, telegramId: string) {
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

