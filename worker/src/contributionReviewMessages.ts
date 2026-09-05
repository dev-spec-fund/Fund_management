import type { Env } from "./types";
import { editMessageCaption, editMessageText } from "./telegram";
import { esc } from "./botSupport";

export async function recordContributionReviewMessage(
  env:Env,
  contributionId:number,
  message:{
    admin_telegram_id?:string|null;
    telegram_chat_id:string|number;
    telegram_message_id:number;
    message_kind?:"photo"|"text";
  }
){
  if(!Number.isInteger(contributionId)||contributionId<=0||!message.telegram_message_id)return;
  await env.DB.prepare(`INSERT INTO contribution_review_messages
    (contribution_id,admin_telegram_id,telegram_chat_id,telegram_message_id,message_kind)
    VALUES(?,?,?,?,?)
    ON CONFLICT(telegram_chat_id,telegram_message_id) DO UPDATE SET
      contribution_id=excluded.contribution_id,
      admin_telegram_id=COALESCE(excluded.admin_telegram_id,contribution_review_messages.admin_telegram_id),
      message_kind=excluded.message_kind`)
    .bind(contributionId,message.admin_telegram_id||null,String(message.telegram_chat_id),Number(message.telegram_message_id),message.message_kind||"photo").run();
}

function finalCaption(row:any, decision:"approved"|"rejected", adminName:string, reason?:string|null){
  const result=decision==="approved"
    ? `✅ <b>Approved by ${esc(adminName)}</b>`
    : `❌ <b>Rejected by ${esc(adminName)}</b>${reason?`\nReason: ${esc(reason)}`:""}`;
  return `🧾 <b>Contribution review</b>\n\n`+
    `Member: <b>${esc(row.member_name||"Member")}</b> (${esc(row.member_code||"")})\n`+
    `Txn: <code>${esc(row.txn_id||"")}</code>\n`+
    `Amount: <b>MVR ${Number(row.amount||0).toFixed(2)}</b>\n`+
    `Month: ${esc(row.month||"")}\n`+
    `Bank ref: <code>${esc(row.ref_number||"not detected")}</code>\n`+
    `Bank date: ${esc(row.bank_date||"—")}\n\n${result}`;
}

export async function syncContributionReviewMessages(
  env:Env,
  contributionId:number,
  decision:"approved"|"rejected",
  adminName:string,
  reason?:string|null
){
  const contribution=await env.DB.prepare(`SELECT c.*,m.name member_name,m.member_code
    FROM contributions c LEFT JOIN members m ON m.id=c.member_id WHERE c.id=?`).bind(contributionId).first<any>();
  if(!contribution)return {updated:0,failed:0,total:0};

  const messages=await env.DB.prepare(`SELECT * FROM contribution_review_messages
    WHERE contribution_id=? AND COALESCE(last_sync_status,'')<>'updated' ORDER BY id`).bind(contributionId).all<any>();
  const caption=finalCaption(contribution,decision,adminName,reason);
  let updated=0,failed=0;

  await Promise.all(messages.results.map(async (message:any)=>{
    const extra={reply_markup:{inline_keyboard:[]}};
    const result:any=message.message_kind==="text"
      ? await editMessageText(env,message.telegram_chat_id,Number(message.telegram_message_id),caption,extra)
      : await editMessageCaption(env,message.telegram_chat_id,Number(message.telegram_message_id),caption,extra);
    const ok=!!result?.ok;
    if(ok)updated++; else failed++;
    await env.DB.prepare(`UPDATE contribution_review_messages
      SET last_synced_at=datetime('now'),last_sync_status=? WHERE id=?`)
      .bind(ok?"updated":"failed",message.id).run().catch(()=>{});
  }));

  return {updated,failed,total:messages.results.length};
}
