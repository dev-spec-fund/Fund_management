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

  // A custom role replaces the built-in Treasurer/Viewer permission set.
  if (admin.custom_role_id) return Array.isArray(admin.permissions) && admin.permissions.includes(permission as any);

  if (role === "treasurer") return permission === "read" || permission === "finance";
  if (role === "viewer") return permission === "read";
  return false;
}

const REQUIRED_SCHEMA_VERSION = 22;
let schemaReady = false;
export async function ensureOperationalSchema(env: Env) {
  if (schemaReady) return;
  try {
    const version = await env.DB.prepare("SELECT MAX(version) version FROM schema_migrations").first<{version:number}>();
    if (Number(version?.version || 0) < REQUIRED_SCHEMA_VERSION) {
      throw new Error(`Database migration required: expected schema version ${REQUIRED_SCHEMA_VERSION}`);
    }
    const checks:[string,string[]][] = [
      ["admins", ["active","deactivated_at","deactivated_by","custom_role_id"]],
      ["members", ["normalized_name","normalized_phone"]],
      ["member_registration_requests", ["phone"]],
      ["contributions", ["bank_date","corrected_by","corrected_at","voided_by","voided_at","void_reason","duplicate_key"]],
      ["donations", ["member_id","project_id","transaction_month","status","voided_by","voided_at","void_reason"]],
      ["expenses", ["expense_date","transaction_month","status","approved_by","approved_at","voided_by","voided_at","void_reason","project_id","fund_override","fund_override_reason","fund_override_by","fund_override_at","fund_balance_before","budget_override_reason","budget_override_by"]],
      ["projects", ["project_code","name","budget","status","responsible_member_id"]],
      ["expense_documents", ["expense_id","telegram_file_id","original_filename","display_name","document_type","uploaded_by","created_at","removed_at","removed_by","removal_reason"]],
      ["expense_categories", ["active"]],
      ["meetings", ["updated_at","last_notification_at","cancelled_at","cancelled_by","cancel_reason"]],
      ["error_log", ["status","resolved_at","resolved_by"]],
      ["monthly_snapshots", ["month","closing_balance","collection_rate"]],
      ["financial_reversals", ["reversal_id","entity_type","entity_id","reason"]],
      ["meeting_minutes", ["meeting_id","minutes","decisions"]],
      ["meeting_action_items", ["meeting_id","description","status"]],
      ["admin_roles", ["name","active","created_by","created_at"]],
      ["admin_role_permissions", ["role_id","permission"]],
    ];
    for (const [table,required] of checks) {
      const rows=await env.DB.prepare(`PRAGMA table_info(${table})`).all<any>();
      const cols=new Set(rows.results.map((r:any)=>String(r.name)));
      const missing=required.filter(col=>!cols.has(col));
      if(missing.length) throw new Error(`Database schema incomplete: ${table}.${missing.join(',')}`);
    }
    schemaReady = true;
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
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

export async function availableFundBalance(env: Env) {
  const row = await env.DB.prepare(`SELECT
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status='approved') +
    (SELECT COALESCE(SUM(amount),0) FROM donations WHERE COALESCE(status,'active')='active') -
    (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE COALESCE(status,'approved')='approved') balance`).first<{balance:number}>();
  return Number(row?.balance || 0);
}

export function contributionDuplicateKey(ref: string | null | undefined, amount: number, bankDate: string | null | undefined) {
  const nref = normalizeRef(ref);
  const date = String(bankDate || "").trim();
  if (!nref || !date || !Number.isFinite(amount) || amount <= 0) return null;
  return `${nref}|${Math.round(amount * 100)}|${date}`;
}

export async function duplicateSlip(env: Env, ref: string | null, amount: number, bankDate: string | null, excludeId?: number) {
  const date = bankDate || new Date().toISOString().slice(0,10);
  const key = contributionDuplicateKey(ref, amount, date);
  if (!key) return null;
  const byKey = await env.DB.prepare(`SELECT id, txn_id, member_id, amount, ref_number, bank_date, status, submitted_at
    FROM contributions WHERE duplicate_key=? AND status NOT IN ('rejected','voided','reversed') ${excludeId ? "AND id<>?" : ""} LIMIT 1`)
    .bind(...(excludeId ? [key, excludeId] : [key])).first<any>();
  if (byKey) return byKey;

  // Legacy fallback covers pre-v11 rows that could not receive a canonical key.
  const nref = normalizeRef(ref);
  const stmt = env.DB.prepare(`SELECT id, txn_id, member_id, amount, ref_number, bank_date, status, submitted_at
    FROM contributions
    WHERE status NOT IN ('rejected','voided','reversed') AND ABS(amount-?) < 0.005
      AND COALESCE(bank_date, substr(submitted_at,1,10)) = ?
      ${excludeId ? "AND id != ?" : ""}
    ORDER BY submitted_at DESC LIMIT 30`);
  const q = excludeId ? stmt.bind(amount, date, excludeId) : stmt.bind(amount, date);
  const rows = await q.all<any>();
  return rows.results.find((r:any) => normalizeRef(r.ref_number) === nref) || null;
}

export async function findDuplicateMembers(env: Env, name?: string | null, phone?: string | null, telegramId?: string | null, excludeId?: number) {
  const nn=normalizeName(name), np=normalizePhone(phone), tg=String(telegramId||"").trim();
  if(!nn && !np && !tg) return [];
  const clauses:string[]=[]; const values:any[]=[];
  if(tg){clauses.push("telegram_id=?");values.push(tg);}
  if(np){clauses.push("normalized_phone=?");values.push(np);}
  if(nn){clauses.push("normalized_name=?");values.push(nn);}
  let sql=`SELECT id,member_code,name,phone,telegram_id,active FROM members WHERE (${clauses.join(" OR ")})`;
  if(excludeId){sql+=" AND id<>?";values.push(excludeId);}
  sql+=" ORDER BY active DESC,name LIMIT 10";
  return (await env.DB.prepare(sql).bind(...values).all<any>()).results;
}

const AUDIT_SENSITIVE_KEYS = new Set([
  "ocr_raw", "slip_file_id", "file_id", "telegram_file_id", "photo_file_id",
  "image", "image_bytes", "raw", "ai_response", "model_response", "prompt",
]);

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 25).map(v => sanitizeAuditValue(v, depth + 1));
  if (typeof value === "object") {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (AUDIT_SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      clean[key] = sanitizeAuditValue(val, depth + 1);
    }
    return clean;
  }
  return String(value);
}

export function sanitizeAuditDetail(detail: unknown): unknown {
  if (typeof detail !== "string") return sanitizeAuditValue(detail);
  try { return sanitizeAuditValue(JSON.parse(detail)); }
  catch { return detail.length > 500 ? `${detail.slice(0, 500)}…` : detail; }
}

const VIEWER_PRIVATE_KEYS = new Set([
  "phone", "normalized_phone", "telegram_id", "telegram_user_id", "chat_id", "slip_file_id",
  "ref_number", "bank_reference", "bank_ref", "reference",
]);

function redactViewerAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0,25).map(v=>redactViewerAuditValue(v,depth+1));
  if (value && typeof value === "object") {
    const clean:Record<string,unknown>={};
    for (const [key,val] of Object.entries(value as Record<string,unknown>)) {
      clean[key]=VIEWER_PRIVATE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactViewerAuditValue(val,depth+1);
    }
    return clean;
  }
  return value;
}

export function sanitizeAuditDetailForRole(detail: unknown, role?: string | null): unknown {
  const clean=sanitizeAuditDetail(detail);
  return role === "viewer" ? redactViewerAuditValue(clean) : clean;
}

export async function auditEntity(env: Env, adminId: number | null, action: string, entity: string, entityId: number | string | null, before?: unknown, after?: unknown) {
  const detail = sanitizeAuditValue({ entity, entity_id: entityId, before: before ?? null, after: after ?? null });
  await logAudit(env, adminId, action, JSON.stringify(detail));
}
