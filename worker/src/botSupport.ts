import type { Env } from "./types";
import { getSetting } from "./db";
import { adminCan, findDuplicateMembers } from "./ops";
import { sendMessage, sendPhoto } from "./telegram";

const DEFAULT_MINI_APP_URL = "https://fund-management.pages.dev";
let cachedMiniAppUrl: { value: string; expiresAt: number } | null = null;

export async function miniAppUrl(env: Env) {
  if (cachedMiniAppUrl && cachedMiniAppUrl.expiresAt > Date.now()) return cachedMiniAppUrl.value;
  const value = (await getSetting(env, "mini_app_url")) || DEFAULT_MINI_APP_URL;
  cachedMiniAppUrl = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

export function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function approvalNotificationAdmins(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT a.*, r.name custom_role_name, GROUP_CONCAT(rp.permission) permissions_csv
    FROM admins a
    LEFT JOIN admin_roles r ON r.id=a.custom_role_id AND COALESCE(r.active,1)=1
    LEFT JOIN admin_role_permissions rp ON rp.role_id=r.id
    WHERE COALESCE(a.active,1)=1 AND a.telegram_id IS NOT NULL AND trim(a.telegram_id) != ''
    GROUP BY a.id
  `).all<any>();
  return rows.results.map((row:any)=>{
    const permissions=String(row.permissions_csv||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
    delete row.permissions_csv;
    return {...row,permissions};
  }).filter((admin:any)=>adminCan(admin,"approvals_manage"));
}

export async function notifyAdmins(env: Env, text: string, extra: Record<string, unknown> = {}) {
  const admins = await approvalNotificationAdmins(env);
  const results=await Promise.allSettled(admins.map((a:any) => sendMessage(env, a.telegram_id, text, extra)));
  const sent=results.filter((r:any)=>r.status==="fulfilled" && r.value?.ok===true).length;
  return {
    sent,
    failed:results.length-sent,
    recipients:admins.length
  };
}

export async function notifyAdminsWithPhoto(
  env: Env,
  photoFileId: string,
  caption: string,
  extra: Record<string, unknown> = {}
) {
  const admins = await approvalNotificationAdmins(env);
  const results = await Promise.allSettled(admins.map(async (a:any) => {
    const response:any = await sendPhoto(env, a.telegram_id, photoFileId, caption, extra);
    return { admin_telegram_id:String(a.telegram_id), response };
  }));
  return results
    .filter((r:any)=>r.status==="fulfilled" && r.value?.response?.ok && r.value?.response?.result?.message_id)
    .map((r:any)=>({
      admin_telegram_id:r.value.admin_telegram_id,
      telegram_chat_id:String(r.value.response.result.chat?.id ?? r.value.admin_telegram_id),
      telegram_message_id:Number(r.value.response.result.message_id),
      message_kind:"photo"
    }));
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

export function sharePhoneKeyboard() {
  return {
    keyboard: [[{ text: "📱 Share phone number", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
    input_field_placeholder: "Tap Share phone number to continue",
  };
}

export async function notifyRegistrationRequest(env: Env, request: any) {
  const matches = (await findDuplicateMembers(env, request.name, request.phone, request.telegram_id))
    .filter((m: any) => !m.telegram_id);
  const usernameLine = request.username ? `\nUsername: @${esc(request.username)}` : "";
  const phoneLine = request.phone ? `\nPhone: <b>${esc(request.phone)}</b>` : "";
  const matchLine = matches.length
    ? `\n\n<b>Possible existing member${matches.length > 1 ? "s" : ""} found:</b>\n${matches.map((m: any) => `${esc(m.member_code)} — ${esc(m.name)}${m.phone ? ` (${esc(m.phone)})` : ""}`).join("\n")}`
    : "\n\nNo matching unlinked member was found.";
  await notifyAdmins(
    env,
    `👤 <b>New member registration request</b>\n\nName: <b>${esc(request.name)}</b>${usernameLine}${phoneLine}\nTelegram ID: <code>${esc(request.telegram_id)}</code>${matchLine}\n\nChoose whether to link an existing member, create a new member, or reject.`,
    { reply_markup: registrationButtons(request.id, matches) }
  );
}
