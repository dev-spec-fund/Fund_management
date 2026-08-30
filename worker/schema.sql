-- KYS Fund — D1 schema
-- Run: wrangler d1 execute kys-fund-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_code TEXT UNIQUE,          -- human-readable, e.g. M0001 — set by trigger below
  telegram_id TEXT UNIQUE,          -- linked once member opens the bot
  name TEXT NOT NULL,
  phone TEXT,
  monthly_amount REAL NOT NULL DEFAULT 250,
  active INTEGER NOT NULL DEFAULT 1, -- 1 = active, 0 = deactivated
  joined_at TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS set_member_code
AFTER INSERT ON members
WHEN NEW.member_code IS NULL
BEGIN
  UPDATE members SET member_code = 'M' || substr('0000' || NEW.id, -4, 4) WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'treasurer', -- 'owner' | 'treasurer'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,                -- human-readable, e.g. TXN-C000123
  member_id INTEGER NOT NULL REFERENCES members(id),
  amount REAL NOT NULL,
  month TEXT NOT NULL,              -- 'YYYY-MM'
  ref_number TEXT,                  -- bank transfer reference (from the slip itself)
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  slip_file_id TEXT,                -- Telegram file_id of the slip photo
  ocr_raw TEXT,                     -- raw OCR response, for debugging
  approved_by INTEGER REFERENCES admins(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contributions_member ON contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_month ON contributions(month);
CREATE INDEX IF NOT EXISTS idx_contributions_ref ON contributions(ref_number);

CREATE TRIGGER IF NOT EXISTS set_contribution_txn_id
AFTER INSERT ON contributions
WHEN NEW.txn_id IS NULL
BEGIN
  UPDATE contributions SET txn_id = 'TXN-C' || substr('000000' || NEW.id, -6, 6) WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,                -- human-readable, e.g. TXN-D000045
  donor_name TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  slip_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS set_donation_txn_id
AFTER INSERT ON donations
WHEN NEW.txn_id IS NULL
BEGIN
  UPDATE donations SET txn_id = 'TXN-D' || substr('000000' || NEW.id, -6, 6) WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,                -- human-readable, e.g. TXN-E000078
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES expense_categories(id),
  amount REAL NOT NULL,
  receipt_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  edited_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TRIGGER IF NOT EXISTS set_expense_txn_id
AFTER INSERT ON expenses
WHEN NEW.txn_id IS NULL
BEGIN
  UPDATE expenses SET txn_id = 'TXN-E' || substr('000000' || NEW.id, -6, 6) WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS exemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  month TEXT NOT NULL,              -- 'YYYY-MM'
  reason TEXT,
  granted_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed defaults
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('fund_name', 'Kanditheemu Youth Society'),
  ('default_monthly_amount', '250'),
  ('reminder_day', '5'),
  ('notify_new_slip', '1'),
  ('notify_member_deactivated', '1'),
  ('notify_budget_exceeded', '0'),
  ('notify_monthly_report', '0');

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES admins(id),
  action TEXT NOT NULL,             -- e.g. 'approve_payment', 'edit_expense'
  detail TEXT,                      -- human-readable summary, incl. old->new
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO expense_categories (name) VALUES ('Events'), ('Maintenance'), ('Welfare support');
