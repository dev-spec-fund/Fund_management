import type { Env, Admin } from "./types";
import { logAudit } from "./db";

export function normalizeName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ");
}

export function normalizePhone(value: string | null | undefined) {
  return String(value || "").replace(/\D+/g, "").replace(/^960/, "");
}

export function normalizeRef(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function adminCan(admin: Admin | null | undefined, permission: "read" | "finance" | "manage_admins" | "close_month" | "backup") {
  if (!admin) return false;
  const role = admin.role === "owner" ? "super_admin" : admin.role;
  if (role === "super_admin") return true;
  if (role === "treasurer") return permission === "read" || permission === "finance";
  if (role === "viewer") return permission === "read";
  return false;
}

async function tableColumns(env: Env, table: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>();
  return new Set(rows.results.map((r: any) => String(r.name)));
}

async function addColumn(env: Env, table: string, column: string, sqlType: string) {
  const cols = await tableColumns(env, table);
  if (!cols.has(column)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`).run();
}

let schemaReady = false;
export async function ensureOperationalSchema(env: Env) {
  if (schemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT NOT NULL,
    subject TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(bucket, subject, window_start)
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS month_closures (
    month TEXT PRIMARY KEY,
    closed_by INTEGER NOT NULL REFERENCES admins(id),
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT
  )`).run();

  await addColumn(env, "admins", "active", "INTEGER NOT NULL DEFAULT 1");
  await addColumn(env, "admins", "deactivated_at", "TEXT");
  await addColumn(env, "admins", "deactivated_by", "INTEGER REFERENCES admins(id)");

  await addColumn(env, "contributions", "bank_date", "TEXT");
  await addColumn(env, "contributions", "corrected_by", "INTEGER REFERENCES admins(id)");
  await addColumn(env, "contributions", "corrected_at", "TEXT");
  await addColumn(env, "contributions", "voided_by", "INTEGER REFERENCES admins(id)");
  await addColumn(env, "contributions", "voided_at", "TEXT");
  await addColumn(env, "contributions", "void_reason", "TEXT");

  await addColumn(env, "donations", "member_id", "INTEGER REFERENCES members(id)");
  await addColumn(env, "donations", "transaction_month", "TEXT");
  await addColumn(env, "donations", "status", "TEXT NOT NULL DEFAULT 'active'");
  await addColumn(env, "donations", "voided_by", "INTEGER REFERENCES admins(id)");
  await addColumn(env, "donations", "voided_at", "TEXT");
  await addColumn(env, "donations", "void_reason", "TEXT");

  await addColumn(env, "expenses", "transaction_month", "TEXT");
  await addColumn(env, "expenses", "status", "TEXT NOT NULL DEFAULT 'approved'");
  await addColumn(env, "expenses", "approval_required", "INTEGER NOT NULL DEFAULT 0");
  await addColumn(env, "expenses", "approved_by", "INTEGER REFERENCES admins(id)");
  await addColumn(env, "expenses", "approved_at", "TEXT");
  await addColumn(env, "expenses", "voided_by", "INTEGER REFERENCES admins(id)");
  await addColumn(env, "expenses", "voided_at", "TEXT");
  await addColumn(env, "expenses", "void_reason", "TEXT");

  await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('expense_approval_threshold','5000')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('mini_app_url','https://fund-management.pages.dev')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('reminder_schedule','Daily 00:00 Maldives (19:00 UTC)')").run();
  schemaReady = true;
}

export async function safeLogError(env: Env, source: string, error: unknown, detail?: unknown) {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const extra = detail === undefined ? (error instanceof Error ? error.stack : null) : JSON.stringify(detail);
    await env.DB.prepare("INSERT INTO error_log (source,message,detail) VALUES (?,?,?)")
      .bind(source, message.slice(0, 1000), String(extra || "").slice(0, 8000) || null).run();
  } catch (e) {
    console.error("Failed to persist error", e, error);
  }
}

export async function consumeRateLimit(env: Env, bucket: string, subject: string, limit: number, windowSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(`INSERT INTO rate_limits (bucket,subject,window_start,count) VALUES (?,?,?,1)
    ON CONFLICT(bucket,subject,window_start) DO UPDATE SET count=count+1
    RETURNING count`)
    .bind(bucket, subject, windowStart).first<{count:number}>();
  if (Math.random() < 0.01) {
    // Cleanup is best-effort and intentionally not awaited on the hot path.
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(windowStart - 86400).run().catch(() => {});
  }
  return (row?.count || 0) <= limit;
}

export async function isMonthClosed(env: Env, month: string) {
  const row = await env.DB.prepare("SELECT month FROM month_closures WHERE month=?").bind(month).first();
  return !!row;
}

export async function requireOpenMonth(env: Env, month: string) {
  if (await isMonthClosed(env, month)) throw new Error(`Month ${month} is closed and cannot be changed.`);
}

export async function duplicateSlip(env: Env, ref: string | null, amount: number, bankDate: string | null, excludeId?: number) {
  const nref = normalizeRef(ref);
  if (!nref) return null;
  const date = bankDate || new Date().toISOString().slice(0,10);
  const stmt = env.DB.prepare(`SELECT id, txn_id, member_id, amount, ref_number, bank_date, status, submitted_at
    FROM contributions
    WHERE status NOT IN ('rejected','voided') AND ABS(amount-?) < 0.005
      AND COALESCE(bank_date, substr(submitted_at,1,10)) = ?
      ${excludeId ? "AND id != ?" : ""}
    ORDER BY submitted_at DESC LIMIT 30`);
  const q = excludeId ? stmt.bind(amount, date, excludeId) : stmt.bind(amount, date);
  const rows = await q.all<any>();
  return rows.results.find((r:any) => normalizeRef(r.ref_number) === nref) || null;
}

export async function findDuplicateMembers(env: Env, name?: string | null, phone?: string | null, telegramId?: string | null, excludeId?: number) {
  const all = await env.DB.prepare("SELECT id,member_code,name,phone,telegram_id,active FROM members").all<any>();
  const nn = normalizeName(name); const np = normalizePhone(phone); const tg = String(telegramId || "");
  return all.results.filter((m: any) => {
    if (excludeId && Number(m.id) === Number(excludeId)) return false;
    return (tg && String(m.telegram_id || "") === tg) || (np && normalizePhone(m.phone) === np) || (nn && normalizeName(m.name) === nn);
  }).slice(0,10);
}

export async function auditEntity(env: Env, adminId: number | null, action: string, entity: string, entityId: number | string | null, before?: unknown, after?: unknown) {
  await logAudit(env, adminId, action, JSON.stringify({ entity, entity_id: entityId, before: before ?? null, after: after ?? null }));
}
