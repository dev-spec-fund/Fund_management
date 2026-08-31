import type { Context, Next } from "hono";
import type { AppEnv } from "./types";
import { getAdminByTelegramId } from "./db";
import { adminCan } from "./ops";

const LOCAL_DEV_TELEGRAM_ID = "999000";

async function useLocalDevAuth(c: Context<AppEnv>, next: Next) {
  await c.env.DB.prepare(`
    INSERT INTO admins (telegram_id, name, role)
    VALUES (?, 'Local Dev Admin', 'super_admin')
    ON CONFLICT(telegram_id) DO UPDATE SET name = excluded.name, role = excluded.role
  `).bind(LOCAL_DEV_TELEGRAM_ID).run();

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO members (member_code, telegram_id, name, phone, monthly_amount)
    VALUES ('M0000', ?, 'Local Dev Member', '000', 250)
  `).bind(LOCAL_DEV_TELEGRAM_ID).run();

  const user = {
    id: Number(LOCAL_DEV_TELEGRAM_ID),
    first_name: "Local",
    last_name: "Dev",
    username: "local_dev",
  };

  c.set("telegramUser", user);
  c.set("admin", await getAdminByTelegramId(c.env, LOCAL_DEV_TELEGRAM_ID));
  await next();
}

/**
 * Verifies Telegram WebApp initData (HMAC-SHA256 per Telegram's spec) and
 * attaches the verified Telegram user + admin record (if any) to context.
 *
 * Newer Telegram clients may include an Ed25519 `signature` field in initData.
 * Different client generations have produced bot-token hashes with slightly
 * different treatment of that field, so we verify the current form first
 * (without `signature`) and retain a compatibility check that includes it.
 */
export async function telegramAuth(c: Context<AppEnv>, next: Next) {
  const initData = c.req.header("X-Telegram-Init-Data");
  const hostname = new URL(c.req.url).hostname;
  const localDevHost = hostname === "127.0.0.1" || hostname === "localhost";
  if (!initData && localDevHost) return useLocalDevAuth(c, next);
  if (!initData) return c.json({ error: "Missing Telegram auth" }, 401);

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return c.json({ error: "Missing Telegram auth hash" }, 401);

  params.delete("hash");

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = 3600;
  if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > maxAgeSeconds) {
    return c.json({ error: "Telegram authentication expired" }, 401);
  }

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

  const safeEqual = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  let valid = safeEqual(hashWithoutSignature, hash);

  // Compatibility with client/library generations that include `signature`
  // in the bot-token HMAC data-check-string.
  if (!valid && params.has("signature")) {
    const hashWithSignature = await computeHash(allEntries);
    valid = safeEqual(hashWithSignature, hash);
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

export function requireAdmin(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (!admin) return c.json({ error: "Admin access required" }, 403);
  return next();
}

export function requireOwner(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (!admin || (admin.role !== "owner" && admin.role !== "super_admin")) return c.json({ error: "Owner access required" }, 403);
  return next();
}

export function requireFinance(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (!adminCan(admin, "finance")) return c.json({ error: "Treasurer or Super Admin access required" }, 403);
  return next();
}

export function requireSuperAdmin(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (!adminCan(admin, "manage_admins")) return c.json({ error: "Super Admin access required" }, 403);
  return next();
}

export async function requireMemberOrAdmin(c: Context<AppEnv>, next: Next) {
  const admin = c.get("admin");
  if (admin) return next();
  const user = c.get("telegramUser");
  const member = await c.env.DB.prepare("SELECT id FROM members WHERE telegram_id=? AND active=1 LIMIT 1").bind(String(user?.id || "")).first();
  if (!member) return c.json({ error: "Approved member or admin access required" }, 403);
  return next();
}
