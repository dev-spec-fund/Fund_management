-- KYS Fund — D1 schema
-- Paste and run EACH statement below ONE AT A TIME into the D1 console
-- (Cloudflare dashboard → D1 → your database → Console tab).
-- The console only runs single statements, so this file avoids multi-statement
-- blocks like triggers — member/transaction codes are generated in the Worker
-- code instead (see src/db.ts: generateMemberCode / generateTxnId).

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_code TEXT UNIQUE,
  telegram_id TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  monthly_amount REAL NOT NULL DEFAULT 250,
  active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'treasurer',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS member_registration_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES admins(id),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  amount REAL NOT NULL,
  month TEXT NOT NULL,
  ref_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  slip_file_id TEXT,
  ocr_raw TEXT,
  approved_by INTEGER REFERENCES admins(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_contributions_member ON contributions(member_id);

CREATE INDEX IF NOT EXISTS idx_contributions_month ON contributions(month);

CREATE INDEX IF NOT EXISTS idx_contributions_ref ON contributions(ref_number);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  donor_name TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  slip_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES expense_categories(id),
  amount REAL NOT NULL,
  receipt_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  edited_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS exemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  month TEXT NOT NULL,
  reason TEXT,
  granted_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admins(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('fund_name', 'Kanditheemu Youth Society');

INSERT OR IGNORE INTO settings (key, value) VALUES ('default_monthly_amount', '250');

INSERT OR IGNORE INTO settings (key, value) VALUES ('reminder_day', '5');

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_new_slip', '1');

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_member_deactivated', '1');

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_budget_exceeded', '0');

INSERT OR IGNORE INTO settings (key, value) VALUES ('notify_monthly_report', '0');

INSERT OR IGNORE INTO expense_categories (name) VALUES ('Events');

INSERT OR IGNORE INTO expense_categories (name) VALUES ('Maintenance');

INSERT OR IGNORE INTO expense_categories (name) VALUES ('Welfare support');
