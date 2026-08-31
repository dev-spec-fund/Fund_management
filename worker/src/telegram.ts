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
  const fileInfo = (await fileInfoRes.json()) as any;
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

function cleanDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();

  let m = raw.match(/\b(20\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.]([0-2]?\d|3[01])\b/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[3])).padStart(2,"0")}`;

  m = raw.match(/\b([0-2]?\d|3[01])[-\/.](0?[1-9]|1[0-2])[-\/.](20\d{2})\b/);
  if (m) return `${m[3]}-${String(Number(m[2])).padStart(2,"0")}-${String(Number(m[1])).padStart(2,"0")}`;

  return null;
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

function parseModelJson(text: string): { amount: number | null; ref: string | null; date: string | null } {
  const raw = String(text || "").trim();

  // 1) Try a complete JSON object if the model returned one.
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed: any = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
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
      const date = cleanDate(parsed.date ?? parsed.transaction_date);
      if (amount !== null || ref || date) return { amount, ref, date };
    } catch {
      // Continue with tolerant parsing.
    }
  }

  // 2) Preferred non-JSON response:
  // AMOUNT=40.00
  // REF=BLAZ384307001924
  // DATE=2026-08-31
  const amountLine = raw.match(/(?:^|\n)\s*(?:AMOUNT|TRANSFER_AMOUNT|TRANSACTION_AMOUNT)\s*[:=]\s*([^\n]+)/i);
  const refLine = raw.match(/(?:^|\n)\s*(?:REF|REFERENCE|REFERENCE_NUMBER|TRANSACTION_REFERENCE|TRANSACTION_ID)\s*[:=]\s*([^\n]+)/i);
  const dateLine = raw.match(/(?:^|\n)\s*(?:DATE|TRANSACTION_DATE)\s*[:=]\s*([^\n]+)/i);

  let amount = cleanAmount(amountLine?.[1]);
  let ref = cleanRef(refLine?.[1]);
  let date = cleanDate(dateLine?.[1]);

  // 3) Tolerate malformed/truncated JSON fields.
  if (amount === null) {
    const m = raw.match(/["']?(?:amount|transfer_amount|transaction_amount|paid_amount)["']?\s*:\s*["']?([^,"'}\n]+)/i);
    amount = cleanAmount(m?.[1]);
  }
  if (!ref) {
    const m = raw.match(/["']?(?:ref|reference|reference_number|transaction_reference|transaction_id|transaction_number|txn_id|txn_ref)["']?\s*:\s*["']?([A-Z0-9\-_/]{4,})/i);
    ref = cleanRef(m?.[1]);
  }
  if (!date) {
    const m = raw.match(/["']?(?:date|transaction_date)["']?\s*:\s*["']?([^,"'}\n]+)/i);
    date = cleanDate(m?.[1]);
  }

  // 4) Last fallback: parse human-readable labels in the response.
  const local = parseSlipText(raw);
  if (amount === null) amount = local.amount;
  if (!ref) ref = local.ref;
  if (!date) date = cleanDate(raw);

  return { amount, ref, date };
}

function modelText(result: any): string {
  const message = result?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map((x:any)=>typeof x==="string"?x:(x?.text||"")).filter(Boolean).join("\n");
    if (joined.trim()) return joined;
  }
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result === "string") return result.result;
  if (typeof result?.description === "string") return result.description;
  return "";
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
  // First path: Cloudflare's document/image text conversion. For bank slips this
  // often preserves labels such as Amount, Reference and Transaction date very well.
  let extractedText = "";
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
    if (first?.format !== "error") {
      extractedText = String(first?.data || first?.text || "");
      const parsed = parseSlipText(extractedText);
      const date = cleanDate(extractedText);
      if (parsed.amount !== null && parsed.ref) {
        return {
          amount: parsed.amount,
          ref: parsed.ref,
          raw: JSON.stringify({ amount: parsed.amount, ref: parsed.ref, date }),
        };
      }
    } else {
      await safeLogError(env, "ocr.convert", new Error(first?.error || "OCR conversion error"));
    }
  } catch (err) {
    await safeLogError(env, "ocr.convert", err);
  }

  // Second path: direct vision extraction. Thinking is disabled so the model spends
  // its output budget on the requested fields rather than internal reasoning.
  let firstVision: { amount: number | null; ref: string | null; date: string | null } = {
    amount: null,
    ref: null,
    date: null,
  };

  const runVision = async (retry = false) => {
    const prompt = retry
      ? "Read the bank transfer slip image carefully. Reply with ONLY three lines: AMOUNT=<MVR transferred amount or null>\\nREF=<bank transaction/reference number or null>\\nDATE=<transaction date as YYYY-MM-DD or null>. Never use an account number as REF."
      : "Read this Maldivian bank transfer slip. Extract the transferred MVR amount, BANK reference number, and transaction date. Reply ONLY as AMOUNT=<number|null>\\nREF=<string|null>\\nDATE=<YYYY-MM-DD|null>. Never use account/card/phone/customer/beneficiary numbers as REF.";

    const result: any = await (env.AI as any).run(
      "@cf/google/gemma-4-26b-a4b-it" as any,
      {
        messages: [
          { role: "system", content: "You are a precise bank-slip OCR extractor. Read only visible text. Never invent values." },
          { role: "user", content: prompt },
        ],
        image: imageDataUrl(imageBytes, mime),
        max_tokens: 120,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
      } as any
    );

    const text = modelText(result);
    return { parsed: parseModelJson(text), raw: text };
  };

  try {
    const one = await runVision(false);
    firstVision = one.parsed;
    if (one.parsed.amount !== null && one.parsed.ref) {
      return {
        amount: one.parsed.amount,
        ref: one.parsed.ref,
        raw: JSON.stringify(one.parsed),
      };
    }

    const two = await runVision(true);
    const merged = {
      amount: two.parsed.amount ?? firstVision.amount,
      ref: two.parsed.ref ?? firstVision.ref,
      date: two.parsed.date ?? firstVision.date,
    };
    if (merged.amount !== null || merged.ref) {
      return { amount: merged.amount, ref: merged.ref, raw: JSON.stringify(merged) };
    }
  } catch (err) {
    await safeLogError(env, "ocr.vision", err);
  }

  // Last chance: use whichever text we did obtain from conversion.
  const local = parseSlipText(extractedText);
  const date = cleanDate(extractedText);
  return {
    amount: local.amount,
    ref: local.ref,
    raw: JSON.stringify({ amount: local.amount, ref: local.ref, date }),
  };
}
