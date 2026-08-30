import type { Env, Admin } from "./types";

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Generates the next human-readable member code, e.g. M0001, M0002. */
export async function generateMemberCode(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM members").first<{ n: number }>();
  const next = (row?.n ?? 0) + 1;
  return `M${String(next).padStart(4, "0")}`;
}

/** Generates the next human-readable transaction code for a given kind: 'C' (contribution), 'D' (donation), 'E' (expense). */
export async function generateTxnId(env: Env, kind: "C" | "D" | "E"): Promise<string> {
  const table = kind === "C" ? "contributions" : kind === "D" ? "donations" : "expenses";
  const row = await env.DB.prepare(`SELECT COUNT(*) as n FROM ${table}`).first<{ n: number }>();
  const next = (row?.n ?? 0) + 1;
  return `TXN-${kind}${String(next).padStart(6, "0")}`;
}

export async function getAdminByTelegramId(env: Env, telegramId: string): Promise<Admin | null> {
  const row = await env.DB.prepare("SELECT * FROM admins WHERE telegram_id = ?")
    .bind(telegramId)
    .first<Admin>();
  return row ?? null;
}

export async function logAudit(env: Env, adminId: number | null, action: string, detail: string) {
  await env.DB.prepare(
    "INSERT INTO audit_log (admin_id, action, detail) VALUES (?, ?, ?)"
  ).bind(adminId, action, detail).run();
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

/** Ensures a member row exists for a Telegram user, linking on first contact. */
export async function ensureMemberLinked(env: Env, telegramId: string, displayName: string) {
  const existing = await env.DB.prepare("SELECT id FROM members WHERE telegram_id = ?")
    .bind(telegramId)
    .first<{ id: number }>();
  if (existing) return existing.id;

  // Try matching an admin-created member with no telegram_id yet, by name (best-effort).
  const byName = await env.DB.prepare(
    "SELECT id FROM members WHERE telegram_id IS NULL AND name = ? LIMIT 1"
  ).bind(displayName).first<{ id: number }>();
  if (byName) {
    await env.DB.prepare("UPDATE members SET telegram_id = ? WHERE id = ?")
      .bind(telegramId, byName.id).run();
    return byName.id;
  }
  return null; // admin must add them, or bot can prompt for name-matching
}
