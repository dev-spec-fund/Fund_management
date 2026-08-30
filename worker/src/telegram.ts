import type { Env } from "./types";

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function tg(env: Env, method: string, body: Record<string, unknown>) {
  const res = await fetch(API(env.TELEGRAM_BOT_TOKEN, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Telegram API ${method} failed:`, await res.text());
  }
  return res.json().catch(() => null);
}

export function sendMessage(env: Env, chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

export function answerCallback(env: Env, callbackQueryId: string, text?: string) {
  return tg(env, "answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export function editMessageText(env: Env, chatId: string | number, messageId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg(env, "editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
}

/** Downloads a Telegram file (e.g. slip photo) and returns its bytes + mime type. */
export async function downloadTelegramFile(env: Env, fileId: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const fileInfoRes = await fetch(API(env.TELEGRAM_BOT_TOKEN, "getFile") + `?file_id=${fileId}`);
  const fileInfo = await fileInfoRes.json<any>();
  if (!fileInfo.ok) return null;
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) return null;
  const bytes = await fileRes.arrayBuffer();
  const mime = fileRes.headers.get("content-type") || "image/jpeg";
  return { bytes, mime };
}

/** Stores a slip/receipt photo — simply keeps Telegram's own file_id.
 * Telegram retains the file server-side; use downloadTelegramFile(fileId)
 * whenever the actual image bytes are needed (e.g. re-verifying a slip). */
export function slipReference(fileId: string): string {
  return fileId;
}

/** Uses Workers AI vision to read amount + reference number off a slip image. */
export async function ocrSlip(env: Env, imageBytes: ArrayBuffer): Promise<{ amount: number | null; ref: string | null; raw: string }> {
  const input = {
    image: [...new Uint8Array(imageBytes)],
    prompt:
      "This is a bank transfer slip from a Maldivian bank (BML or MIB). " +
      "Extract the transferred AMOUNT (numeric only, MVR) and the REFERENCE/TRANSACTION NUMBER. " +
      'Reply strictly as JSON: {"amount": <number or null>, "ref": "<string or null>"}',
    max_tokens: 256,
  };
  try {
    const result: any = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf" as any, input as any);
    const text = result?.description || result?.response || JSON.stringify(result);
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { amount: parsed.amount ?? null, ref: parsed.ref ?? null, raw: text };
    }
    return { amount: null, ref: null, raw: text };
  } catch (err) {
    return { amount: null, ref: null, raw: `OCR error: ${err}` };
  }
}
