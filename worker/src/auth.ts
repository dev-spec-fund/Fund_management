import type { Context, Next } from "hono";
import type { Env } from "./types";
import { getAdminByTelegramId } from "./db";

/**
 * Verifies Telegram WebApp initData (HMAC-SHA256 per Telegram's spec) and
 * attaches the verified Telegram user + admin record (if any) to context.
 *
 * Newer Telegram clients may include an Ed25519 `signature` field in initData.
 * Different client generations have produced bot-token hashes with slightly
 * different treatment of that field, so we verify the current form first
 * (without `signature`) and retain a compatibility check that includes it.
 */
export async function telegramAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const initData = c.req.header("X-Telegram-Init-Data");
  if (!initData) return c.json({ error: "Missing Telegram auth" }, 401);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return c.json({ error: "Missing Telegram auth hash" }, 401);

  params.delete("hash");

  const encoder = new TextEncoder();

  // secret = HMAC_SHA256(key="WebAppData", message=bot_token)
  const webAppDataKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretBytes = await crypto.subtle.sign(
    "HMAC",
    webAppDataKey,
    encoder.encode(c.env.TELEGRAM_BOT_TOKEN)
  );
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const computeHash = async (entries: [string, string][]) => {
    const dataCheckString = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const signature = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      encoder.encode(dataCheckString)
    );

    return [...new Uint8Array(signature)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  const allEntries = [...params.entries()] as [string, string][];

  // Telegram Bot API 8+ initData may contain a separate Ed25519 `signature`.
  // It is not part of the data-check-string on clients that use the newer
  // validation form. Try that first.
  const withoutEd25519Signature = allEntries.filter(([key]) => key !== "signature");
  const hashWithoutSignature = await computeHash(withoutEd25519Signature);

  let valid = hashWithoutSignature === hash;

  // Compatibility with client/library generations that include `signature`
  // in the bot-token HMAC data-check-string.
  if (!valid && params.has("signature")) {
    const hashWithSignature = await computeHash(allEntries);
    valid = hashWithSignature === hash;
  }

  if (!valid) return c.json({ error: "Invalid Telegram auth" }, 401);

  const userJson = params.get("user");
  let user: any = null;
  try {
    user = userJson ? JSON.parse(userJson) : null;
  } catch {
    return c.json({ error: "Invalid Telegram user data" }, 401);
  }

  if (!user) return c.json({ error: "No user in initData" }, 401);

  c.set("telegramUser", user);
  c.set("admin", await getAdminByTelegramId(c.env, String(user.id)));
  await next();
}

export function requireAdmin(c: Context<any>, next: Next) {
  const admin = c.get("admin");
  if (!admin) return c.json({ error: "Admin access required" }, 403);
  return next();
}

export function requireOwner(c: Context<any>, next: Next) {
  const admin = c.get("admin");
  if (!admin || admin.role !== "owner") return c.json({ error: "Owner access required" }, 403);
  return next();
}
