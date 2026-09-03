import type { Env, Admin } from "./types";

export function currentMonth(timeZone = "Indian/Maldives"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

export function currentDate(timeZone = "Indian/Maldives"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function currentDayOfMonth(timeZone = "Indian/Maldives"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "2-digit",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "day")?.value || "";
}

async function ensureSequenceTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS id_sequences (
      kind TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}

/** Generates the next human-readable member code, e.g. M0001, M0002, without reusing deleted IDs. */
export async function generateMemberCode(env: Env): Promise<string> {
  await ensureSequenceTable(env);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO id_sequences (kind, value)
    SELECT 'M', COALESCE(MAX(CAST(SUBSTR(member_code, 2) AS INTEGER)), 0)
    FROM members WHERE member_code GLOB 'M[0-9]*'
  `).run();
  const row = await env.DB.prepare(
    "UPDATE id_sequences SET value = value + 1 WHERE kind = 'M' RETURNING value"
  ).first<{ value: number }>();
  return `M${String(row?.value ?? 1).padStart(4, "0")}`;
}

/** Generates C0000001 / D0000001 / E0000001 using an atomic persistent sequence. */
export async function generateTxnId(env: Env, kind: "C" | "D" | "E"): Promise<string> {
  await ensureSequenceTable(env);
  const table = kind === "C" ? "contributions" : kind === "D" ? "donations" : "expenses";
  await env.DB.prepare(`
    INSERT OR IGNORE INTO id_sequences (kind, value)
    SELECT ?, COALESCE(MAX(CAST(SUBSTR(txn_id, 2) AS INTEGER)), 0)
    FROM ${table} WHERE txn_id GLOB ?
  `).bind(kind, `${kind}[0-9]*`).run();
  const row = await env.DB.prepare(
    "UPDATE id_sequences SET value = value + 1 WHERE kind = ? RETURNING value"
  ).bind(kind).first<{ value: number }>();
  return `${kind}${String(row?.value ?? 1).padStart(7, "0")}`;
}

export async function getAdminByTelegramId(env: Env, telegramId: string): Promise<Admin | null> {
  const row = await env.DB.prepare(`
    SELECT a.*, r.name custom_role_name,
           GROUP_CONCAT(rp.permission) permissions_csv
    FROM admins a
    LEFT JOIN admin_roles r ON r.id=a.custom_role_id AND COALESCE(r.active,1)=1
    LEFT JOIN admin_role_permissions rp ON rp.role_id=r.id
    WHERE a.telegram_id=? AND COALESCE(a.active,1)=1
    GROUP BY a.id
  `).bind(telegramId).first<any>();
  if (!row) return null;
  const permissions = String(row.permissions_csv || "").split(",").map((x:string)=>x.trim()).filter(Boolean);
  delete row.permissions_csv;
  return { ...row, permissions } as Admin;
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


export async function getBranding(env: Env): Promise<{ fund_name: string; short_name: string }> {
  const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('fund_name','short_name')").all<{key:string;value:string}>();
  const values: Record<string,string> = {};
  for (const row of rows.results) values[row.key] = String(row.value || '').trim();
  const fund_name = values.fund_name || 'Fund';
  const short_name = values.short_name || fund_name.split(/\s+/).filter(Boolean).map((x) => x[0]).join('').slice(0,8).toUpperCase() || 'FUND';
  return { fund_name, short_name };
}

export async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, value).run();
}

/** Strict lookup only. Never links a Telegram account by display name. */
export async function ensureMemberLinked(env: Env, telegramId: string, _displayName?: string) {
  const existing = await env.DB.prepare("SELECT id FROM members WHERE telegram_id = ?")
    .bind(telegramId)
    .first<{ id: number }>();
  return existing?.id ?? null;
}

export async function findUnlinkedMemberMatches(env: Env, displayName: string) {
  if (!displayName.trim()) return [] as any[];
  const rows = await env.DB.prepare(`
    SELECT id, member_code, name, phone, monthly_amount
    FROM members
    WHERE telegram_id IS NULL AND active = 1 AND lower(trim(name)) = lower(trim(?))
    ORDER BY member_code ASC
    LIMIT 3
  `).bind(displayName).all<any>();
  return rows.results;
}

/** Ensures registration storage exists for old D1 databases too. */
export async function ensureMemberRegistrationTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS member_registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      username TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_by INTEGER REFERENCES admins(id),
      reviewed_at TEXT
    )
  `).run();
}

/** Creates a request; a previously rejected user may submit a fresh request later. */
export async function createMemberRegistrationRequest(
  env: Env,
  telegramId: string,
  displayName: string,
  username?: string | null
): Promise<{ id: number; status: string; created: boolean; phone: string | null }> {
  await ensureMemberRegistrationTable(env);

  const existing = await env.DB.prepare(
    "SELECT id, status, phone FROM member_registration_requests WHERE telegram_id = ?"
  ).bind(telegramId).first<{ id: number; status: string; phone: string | null }>();

  if (existing) {
    if (existing.status === "rejected") {
      await env.DB.prepare(`
        UPDATE member_registration_requests
        SET name = ?, username = ?, phone = NULL, status = 'awaiting_phone', requested_at = datetime('now'),
            reviewed_by = NULL, reviewed_at = NULL
        WHERE id = ?
      `).bind(displayName, username || null, existing.id).run();
      return { id: existing.id, status: "awaiting_phone", created: true, phone: null };
    }

    await env.DB.prepare(
      "UPDATE member_registration_requests SET name = ?, username = ? WHERE id = ?"
    ).bind(displayName, username || null, existing.id).run();
    return { id: existing.id, status: existing.status, created: false, phone: existing.phone || null };
  }

  const res = await env.DB.prepare(
    "INSERT INTO member_registration_requests (telegram_id, name, username, status) VALUES (?, ?, ?, 'awaiting_phone')"
  ).bind(telegramId, displayName, username || null).run();

  return { id: Number(res.meta.last_row_id), status: "awaiting_phone", created: true, phone: null };
}
