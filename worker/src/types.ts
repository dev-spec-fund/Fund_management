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

export type AdminRole = "owner" | "super_admin" | "treasurer" | "viewer";
export type Admin = { id:number; telegram_id:string; name:string; role:AdminRole; };

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
