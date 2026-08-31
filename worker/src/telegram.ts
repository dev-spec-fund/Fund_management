import type { Env } from "./types";
import { safeLogError } from "./ops";

const API = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function tg(env: Env, method: string, body: Record<string, unknown>) {
  const res = await fetch(API(env.TELEGRAM_BOT_TOKEN, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`Telegram API ${method} failed:`, detail);
    await safeLogError(env, `telegram.${method}`, new Error(`Telegram API ${res.status}`), detail);
    return null;
  }
  return res.json().catch(async (e) => { await safeLogError(env, `telegram.${method}.json`, e); return null; });
}

export function sendMessage(env: Env, chatId: string | number, text: string, extra: Record<string, unknown> = {}) {
  return tg(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}


export function sendPhoto(env: Env, chatId: string | number, photo: string, caption: string, extra: Record<string, unknown> = {}) {
  return tg(env, "sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra });
}

export function editMessageCaption(env: Env, chatId: string | number, messageId: number, caption: string, extra: Record<string, unknown> = {}) {
  return tg(env, "editMessageCaption", { chat_id: chatId, message_id: messageId, caption, parse_mode: "HTML", ...extra });
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

function cleanRef(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const ref = String(value)
    .trim()
    .replace(/^['"`]+|['"`,.;:]+$/g, "")
    .replace(/\s+/g, "");

  if (!ref || ref.toLowerCase() === "null" || ref.length < 4) return null;
  return ref;
}

function cleanAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value)
    .replace(/MVR|Rf\.?|ރ\.?/gi, "")
    .replace(/,/g, "")
    .replace(/[^0-9.\-]/g, "")
    .trim();
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function parseSlipText(text: string): { amount: number | null; ref: string | null } {
  const normalized = text.replace(/\r/g, "\n");

  // Prefer values explicitly labelled as a bank transaction/reference identifier.
  const refPatterns = [
    /(?:transaction\s*(?:id|reference|ref|number|no\.?|#)|bank\s*(?:reference|ref)|reference\s*(?:number|no\.?|#)?|ref\s*(?:number|no\.?|#)?)[\s:=#-]*([A-Z0-9][A-Z0-9\-_/]{3,})/i,
    /(?:txn|trx)\s*(?:id|ref|no\.?|#)?[\s:=#-]*([A-Z0-9][A-Z0-9\-_/]{3,})/i,
  ];

  let ref: string | null = null;
  for (const pattern of refPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      ref = cleanRef(match[1]);
      if (ref) break;
    }
  }

  // Prefer transfer/paid/amount labels and avoid balances/account numbers.
  const amountPatterns = [
    /(?:transfer(?:red)?\s*amount|transaction\s*amount|amount\s*(?:paid|sent)?|paid\s*amount|total\s*amount)[\s:=\-]*(?:MVR|Rf\.?|ރ\.?\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    /(?:MVR|Rf\.?)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
  ];

  let amount: number | null = null;
  for (const pattern of amountPatterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      amount = cleanAmount(match[1]);
      if (amount !== null) break;
    }
  }

  return { amount, ref };
}

function parseModelJson(text: string): { amount: number | null; ref: string | null } {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return { amount: null, ref: null };

  try {
    const parsed: any = JSON.parse(match[0]);
    const amount = cleanAmount(
      parsed.amount ?? parsed.transfer_amount ?? parsed.transaction_amount ?? parsed.paid_amount
    );
    const ref = cleanRef(
      parsed.ref ??
        parsed.reference ??
        parsed.reference_number ??
        parsed.transaction_id ??
        parsed.transaction_reference ??
        parsed.transaction_number ??
        parsed.txn_id ??
        parsed.txn_ref
    );
    return { amount, ref };
  } catch {
    return { amount: null, ref: null };
  }
}

/** Encodes a Worker ArrayBuffer as a base64 data URL without spreading a large array. */
function imageDataUrl(imageBytes: ArrayBuffer, mime = "image/jpeg"): string {
  const bytes = new Uint8Array(imageBytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Reads a bank slip and extracts transferred amount, bank reference and visible text.
 *
 * Primary path: send the actual image to a vision model and require structured JSON.
 * Fallback: Cloudflare image-to-text conversion plus the local label parser.
 */
export async function ocrSlip(
  env: Env,
  imageBytes: ArrayBuffer,
  mime = "image/jpeg"
): Promise<{ amount: number | null; ref: string | null; raw: string }> {
  let visionRaw = "";

  try {
    const result: any = await (env.AI as any).run(
      "@cf/google/gemma-4-26b-a4b-it" as any,
      {
        messages: [
          {
            role: "system",
            content:
              "You read bank transfer slip images accurately. Never invent text or values that are not visible. Return JSON only.",
          },
          {
            role: "user",
            content:
              "Read this Maldivian bank transfer slip (commonly BML or MIB). Extract only the transferred amount in MVR, the BANK transaction/reference number, and transaction date if visible. Never use account/card/phone/customer/beneficiary IDs, timestamps, or the amount as the reference. Return exactly JSON: {\"amount\":number|null,\"ref\":string|null,\"date\":\"YYYY-MM-DD\"|null}.",
          },
        ],
        image: imageDataUrl(imageBytes, mime),
        max_tokens: 120,
        temperature: 0,
      } as any
    );

    visionRaw =
      result?.choices?.[0]?.message?.content ||
      result?.response ||
      result?.result ||
      result?.description ||
      JSON.stringify(result);

    const jsonMatch = String(visionRaw).match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed: any = JSON.parse(jsonMatch[0]);
        const amount = cleanAmount(parsed.amount);
        const ref = cleanRef(parsed.ref ?? parsed.reference ?? parsed.transaction_reference ?? parsed.transaction_id);
        const date = typeof parsed.date === "string" ? parsed.date.trim() : "";
        const raw = JSON.stringify({ amount, ref, date: /^20\d{2}-\d{2}-\d{2}$/.test(date) ? date : null });
        if (amount !== null || ref) return { amount, ref, raw };
      } catch (err) {
        await safeLogError(env, "ocr.vision.json", err, String(visionRaw).slice(0, 1000));
      }
    }
  } catch (err) {
    await safeLogError(env, "ocr.vision", err);
  }

  let ocrText = "";
  try {
    const extension = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const converted: any = await (env.AI as any).toMarkdown(
      {
        name: `bank-slip.${extension}`,
        blob: new Blob([imageBytes], { type: mime }),
      },
      {
        conversionOptions: {
          output: { format: "text" },
          image: { descriptionLanguage: "en" },
        },
      }
    );

    const first = Array.isArray(converted) ? converted[0] : converted;
    ocrText = first?.data || first?.text || "";
    if (first?.format === "error") {
      await safeLogError(env, "ocr.convert", new Error(first?.error || "OCR conversion error"));
      ocrText = "";
    }
  } catch (err) {
    await safeLogError(env, "ocr.convert", err);
  }

  const local = parseSlipText(ocrText);
  const dateMatch = String(ocrText || visionRaw || "").match(/\b(20\d{2})[-\/.](0[1-9]|1[0-2])[-\/.]([0-2]\d|3[01])\b/);
  const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;
  return {
    amount: local.amount,
    ref: local.ref,
    raw: JSON.stringify({ amount: local.amount, ref: local.ref, date }),
  };
}

