export type Env = {
  DB: D1Database;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_IDS: string;
  FUND_TIMEZONE: string;
  DEV_AUTH_ENABLED?: string;
};

export type Member = {
  id: number;
  member_code: string;
  telegram_id: string | null;
  name: string;
  phone: string | null;
  monthly_amount: number;
  active: number;
  joined_at: string;
  created_at: string;
};

export type AdminRole = "owner" | "super_admin" | "president" | "treasurer" | "secretary" | "viewer";
export type AdminPermission =
  | "read" | "finance"
  | "members_view" | "members_manage" | "approvals_manage"
  | "expenses_view" | "expenses_manage" | "donations_view" | "donations_manage"
  | "reports_view" | "reports_export" | "projects_view" | "projects_manage"
  | "meetings_view" | "meetings_manage" | "elections_view" | "elections_manage" | "elections_certify"
  | "settings_view" | "settings_manage" | "audit_view" | "financial_reversals"
  | "close_month" | "manage_admins" | "backup";
export type Admin = {
  id:number;
  telegram_id:string;
  name:string;
  role:AdminRole;
  custom_role_id?:number|null;
  custom_role_name?:string|null;
  permissions?:AdminPermission[];
};

export type AppEnv = {
  Bindings: Env;
  Variables: {
    telegramUser: any;
    admin: Admin | null;
  };
};

export type Contribution = {
  id:number; txn_id:string; member_id:number; amount:number; month:string;
  ref_number:string|null; bank_date:string|null; status:"pending"|"approved"|"rejected"|"voided"|"reversed";
  slip_file_id:string|null; ocr_raw:string|null; approved_by:number|null;
  submitted_at:string; approved_at:string|null;
};
