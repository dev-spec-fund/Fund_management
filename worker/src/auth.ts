import type { Context, Next } from "hono";
import type { Env } from "./types";
import { getAdminByTelegramId } from "./db";

/**
 * Verifies Telegram WebApp initData (HMAC-SHA256 per Telegram's spec) and
 * attaches the verified telegram user + admin record (if any) to context.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function telegramAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const initData = c.req.header("X-Telegram-Init-Data");
  if (!initData) return c.json({ error: "Missing Telegram auth" }, 401);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    "raw", encoder.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const secretHmac = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(c.env.TELEGRAM_BOT_TOKEN));
  const derivedKey = await crypto.subtle.importKey(
    "raw", secretHmac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", derivedKey, encoder.encode(dataCheckString));
  const computedHash = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (computedHash !== hash) return c.json({ error: "Invalid Telegram auth" }, 401);

  const userJson = params.get("user");
  const user = userJson ? JSON.parse(userJson) : null;
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
