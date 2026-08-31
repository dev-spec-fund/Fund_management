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
  active INTEGER NOT NULL DEFAULT 1,
  deactivated_at TEXT,
  deactivated_by INTEGER REFERENCES admins(id),
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
  approved_at TEXT,
  bank_date TEXT,
  corrected_by INTEGER REFERENCES admins(id),
  corrected_at TEXT,
  voided_by INTEGER REFERENCES admins(id),
  voided_at TEXT,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_contributions_member ON contributions(member_id);

CREATE INDEX IF NOT EXISTS idx_contributions_month ON contributions(month);

CREATE INDEX IF NOT EXISTS idx_contributions_ref ON contributions(ref_number);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  donor_name TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id),
  amount REAL NOT NULL,
  note TEXT,
  slip_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  transaction_month TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  voided_by INTEGER REFERENCES admins(id),
  voided_at TEXT,
  void_reason TEXT,
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
  transaction_month TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  approval_required INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER REFERENCES admins(id),
  approved_at TEXT,
  voided_by INTEGER REFERENCES admins(id),
  voided_at TEXT,
  void_reason TEXT,
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

CREATE TABLE IF NOT EXISTS id_sequences (
  kind TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket, subject, window_start)
);

CREATE TABLE IF NOT EXISTS month_closures (
  month TEXT PRIMARY KEY,
  closed_by INTEGER NOT NULL REFERENCES admins(id),
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('expense_approval_threshold', '5000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('mini_app_url', 'https://fund-management.pages.dev');
INSERT OR IGNORE INTO settings (key, value) VALUES ('reminder_schedule', 'Daily 00:00 Maldives (19:00 UTC)');


-- Automatic future-month contribution allocation.
CREATE TABLE IF NOT EXISTS contribution_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  amount REAL NOT NULL CHECK(amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(contribution_id) REFERENCES contributions(id),
  FOREIGN KEY(member_id) REFERENCES members(id),
  UNIQUE(contribution_id, month)
);

CREATE INDEX IF NOT EXISTS idx_contribution_allocations_member_month
  ON contribution_allocations(member_id, month);
CREATE INDEX IF NOT EXISTS idx_contribution_allocations_contribution
  ON contribution_allocations(contribution_id);


-- Meetings and Telegram RSVP tracking.
CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  meeting_time TEXT NOT NULL,
  venue TEXT,
  agenda TEXT,
  rsvp_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  sent_at TEXT,
  last_notification_at TEXT,
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES admins(id),
  cancel_reason TEXT
);

CREATE TABLE IF NOT EXISTS meeting_rsvps (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')),
  responded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date, meeting_time);
CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting ON meeting_rsvps(meeting_id);
