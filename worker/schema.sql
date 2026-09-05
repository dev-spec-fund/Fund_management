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
  normalized_name TEXT,
  normalized_phone TEXT,
  monthly_amount REAL NOT NULL DEFAULT 250,
  active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(role_id, permission)
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'treasurer',
  custom_role_id INTEGER REFERENCES admin_roles(id),
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
  phone TEXT,
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
  void_reason TEXT,
  duplicate_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_contributions_member ON contributions(member_id);

CREATE INDEX IF NOT EXISTS idx_contributions_month ON contributions(month);

CREATE INDEX IF NOT EXISTS idx_contributions_ref ON contributions(ref_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_live_duplicate_key ON contributions(duplicate_key) WHERE duplicate_key IS NOT NULL AND status NOT IN ('rejected','voided','reversed');
CREATE INDEX IF NOT EXISTS idx_contributions_duplicate_lookup ON contributions(duplicate_key,status);

CREATE TABLE IF NOT EXISTS donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  donor_name TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id),
  project_id INTEGER REFERENCES projects(id),
  amount REAL NOT NULL,
  note TEXT,
  slip_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  transaction_month TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  voided_by INTEGER REFERENCES admins(id),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  donation_date TEXT,
  edited_by INTEGER REFERENCES admins(id),
  updated_at TEXT,
  idempotency_key TEXT
);


CREATE TABLE IF NOT EXISTS donation_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER NOT NULL REFERENCES donations(id),
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  telegram_message_id INTEGER,
  telegram_chat_id TEXT,
  original_filename TEXT NOT NULL,
  display_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  document_type TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER REFERENCES admins(id),
  removal_reason TEXT
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  budget REAL,
  start_date TEXT,
  target_end_date TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed','cancelled')),
  responsible_member_id INTEGER REFERENCES members(id),
  created_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  completed_at TEXT,
  completed_by INTEGER REFERENCES admins(id),
  cancelled_at TEXT,
  cancelled_by INTEGER REFERENCES admins(id),
  cancel_reason TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_id TEXT UNIQUE,
  description TEXT NOT NULL,
  category_id INTEGER REFERENCES expense_categories(id),
  project_id INTEGER REFERENCES projects(id),
  amount REAL NOT NULL,
  receipt_file_id TEXT,
  logged_by INTEGER NOT NULL REFERENCES admins(id),
  edited_by INTEGER REFERENCES admins(id),
  expense_date TEXT,
  transaction_month TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  approved_by INTEGER REFERENCES admins(id),
  approved_at TEXT,
  voided_by INTEGER REFERENCES admins(id),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  fund_override INTEGER NOT NULL DEFAULT 0,
  fund_override_reason TEXT,
  fund_override_by INTEGER REFERENCES admins(id),
  fund_override_at TEXT,
  fund_balance_before REAL,
  budget_override_reason TEXT,
  budget_override_by INTEGER REFERENCES admins(id),
  idempotency_key TEXT
);

CREATE TABLE IF NOT EXISTS expense_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id),
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  telegram_message_id INTEGER,
  telegram_chat_id TEXT,
  original_filename TEXT NOT NULL,
  display_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  document_type TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER REFERENCES admins(id),
  removal_reason TEXT
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
INSERT OR IGNORE INTO settings (key, value) VALUES ('short_name', 'KYS');

INSERT OR IGNORE INTO settings (key, value) VALUES ('default_monthly_amount', '250');
INSERT OR IGNORE INTO settings (key, value) VALUES ('first_month_contribution_rule', 'half_after_15');

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES admins(id)
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


CREATE TABLE IF NOT EXISTS monthly_snapshots (
  month TEXT PRIMARY KEY,
  opening_balance REAL NOT NULL DEFAULT 0,
  contribution_cash REAL NOT NULL DEFAULT 0,
  donation_cash REAL NOT NULL DEFAULT 0,
  expenses REAL NOT NULL DEFAULT 0,
  closing_balance REAL NOT NULL DEFAULT 0,
  total_due REAL NOT NULL DEFAULT 0,
  total_collected REAL NOT NULL DEFAULT 0,
  collection_rate REAL NOT NULL DEFAULT 0,
  active_members INTEGER NOT NULL DEFAULT 0,
  paid_members INTEGER NOT NULL DEFAULT 0,
  partial_members INTEGER NOT NULL DEFAULT 0,
  unpaid_members INTEGER NOT NULL DEFAULT 0,
  exempt_members INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER NOT NULL REFERENCES admins(id),
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS financial_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reversal_id TEXT UNIQUE NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('contribution','expense','donation')),
  entity_id INTEGER NOT NULL,
  original_txn_id TEXT,
  amount REAL NOT NULL,
  month TEXT,
  reason TEXT NOT NULL,
  reversed_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_financial_reversals_month ON financial_reversals(month,created_at);

CREATE TABLE IF NOT EXISTS meeting_minutes (
  meeting_id INTEGER PRIMARY KEY REFERENCES meetings(id),
  minutes TEXT,
  decisions TEXT,
  recorded_by INTEGER NOT NULL REFERENCES admins(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  description TEXT NOT NULL,
  assigned_member_id INTEGER REFERENCES members(id),
  assigned_admin_id INTEGER REFERENCES admins(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','cancelled')),
  created_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  completed_by INTEGER REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_meeting ON meeting_action_items(meeting_id,status,due_date);



CREATE TABLE IF NOT EXISTS member_contribution_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  amount REAL NOT NULL CHECK(amount > 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id,effective_from)
);
CREATE INDEX IF NOT EXISTS idx_member_contribution_rates_member_period ON member_contribution_rates(member_id,effective_from,effective_to);

-- Schema migration ledger. Fresh databases created from schema.sql are current through v21.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (2,'performance_indexes');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (3,'admin_columns_and_runtime_fixes');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (4,'contribution_allocations');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (5,'meetings');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (6,'meeting_management');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (7,'meeting_notification_tracking');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (8,'expense_category_management');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (9,'hardening_and_schema_versioning');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (10,'performance_and_normalized_members');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (11,'integrity_privacy_and_error_resolution');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (12,'registration_phone_capture');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (13,'governance_reporting_and_reversals');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (14,'expense_dates_and_financial_integrity');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (15,'member_contribution_rate_history_and_member_app');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (16,'organization_branding_settings');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (17,'community_projects_and_fund_protection');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (18,'expense_documents_telegram');

CREATE INDEX IF NOT EXISTS idx_members_normalized_name ON members(normalized_name);
CREATE INDEX IF NOT EXISTS idx_members_normalized_phone ON members(normalized_phone);
CREATE INDEX IF NOT EXISTS idx_allocations_member_month_contribution ON contribution_allocations(member_id,month,contribution_id);
CREATE INDEX IF NOT EXISTS idx_allocations_month_contribution ON contribution_allocations(month,contribution_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_member_month ON exemptions(member_id,month);
CREATE INDEX IF NOT EXISTS idx_month_closures_month ON month_closures(month);
CREATE INDEX IF NOT EXISTS idx_expenses_status_transaction_month_category ON expenses(status,transaction_month,category_id);
CREATE INDEX IF NOT EXISTS idx_projects_status_start ON projects(status,start_date);
CREATE INDEX IF NOT EXISTS idx_expense_documents_expense_created ON expense_documents(expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_documents_telegram_file ON expense_documents(telegram_file_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project_status ON expenses(project_id,status,transaction_month);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_donations_status_transaction_month ON donations(status,transaction_month);
CREATE INDEX IF NOT EXISTS idx_donations_project_status_month ON donations(project_id,status,transaction_month);
CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting_member ON meeting_rsvps(meeting_id,member_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status_date ON meetings(status,meeting_date);

CREATE INDEX IF NOT EXISTS idx_error_log_status_created ON error_log(status,created_at DESC);

-- Performance indexes mirrored from migrations so a fresh schema matches an upgraded database.
CREATE INDEX IF NOT EXISTS idx_members_telegram_active ON members(telegram_id, active);
CREATE INDEX IF NOT EXISTS idx_admins_telegram_active_role ON admins(telegram_id, active, role);
CREATE INDEX IF NOT EXISTS idx_contributions_status_month_member ON contributions(status, month, member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status_approved_at ON contributions(status, approved_at);
CREATE INDEX IF NOT EXISTS idx_expenses_status_created ON expenses(status, created_at);
CREATE INDEX IF NOT EXISTS idx_donations_status_created ON donations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_registrations_status_requested ON member_registration_requests(status, requested_at);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (19,'expense_document_management');
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (20,'project_linked_donations');
CREATE INDEX IF NOT EXISTS idx_expense_documents_active ON expense_documents(expense_id, removed_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admins_custom_role ON admins(custom_role_id, active);
CREATE INDEX IF NOT EXISTS idx_admin_role_permissions_role ON admin_role_permissions(role_id);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (21,'custom_admin_roles');

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (22,'remove_expense_approval_workflow');


-- Stability Stage 3
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idempotency_key
  ON expenses(idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- Stability Stage 5: Telegram webhook/update idempotency.
CREATE TABLE IF NOT EXISTS contribution_review_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id INTEGER NOT NULL REFERENCES contributions(id),
  admin_telegram_id TEXT,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  message_kind TEXT NOT NULL DEFAULT 'photo' CHECK(message_kind IN ('photo','text')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,
  last_sync_status TEXT,
  UNIQUE(telegram_chat_id, telegram_message_id)
);
CREATE INDEX IF NOT EXISTS idx_contribution_review_messages_contribution
  ON contribution_review_messages(contribution_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_update_receipts (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','completed','failed')),
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_update_receipts_status_claimed
  ON telegram_update_receipts(status, claimed_at);


-- Donation edit/document support.
CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_idempotency_key ON donations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_donation_documents_active ON donation_documents(donation_id,removed_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donation_documents_telegram_file ON donation_documents(telegram_file_id);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (26,'donation_edit_and_documents');

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (28,'contribution_review_messages');


CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  term TEXT,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed','cancelled')),
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at TEXT,
  closed_at TEXT,
  certified_at TEXT,
  certified_by INTEGER REFERENCES admins(id),
  applications_open_at TEXT,
  applications_close_at TEXT,
  applications_notified_at TEXT,
  applications_reminder_at TEXT
);
CREATE TABLE IF NOT EXISTS election_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  max_selections INTEGER NOT NULL DEFAULT 1,
  min_selections INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS election_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES election_positions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  withdrawn_at TEXT,
  withdrawn_by INTEGER REFERENCES admins(id),
  withdrawal_reason TEXT,
  UNIQUE(election_id,position_id,member_id)
);
CREATE TABLE IF NOT EXISTS election_voters (
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  voted_at TEXT,
  vote_claim TEXT,
  PRIMARY KEY(election_id,member_id)
);
CREATE TABLE IF NOT EXISTS election_ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  ballot_token TEXT NOT NULL,
  position_id INTEGER NOT NULL REFERENCES election_positions(id),
  candidate_id INTEGER NOT NULL REFERENCES election_candidates(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ballot_token,position_id,candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_election_ballots_election ON election_ballots(election_id,position_id,candidate_id);
CREATE INDEX IF NOT EXISTS idx_election_voters_election ON election_voters(election_id,voted_at);


INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(29,'exco_elections');

CREATE INDEX IF NOT EXISTS idx_elections_lifecycle ON elections(status, opens_at, closes_at);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(30,'election_integrity');

CREATE TABLE IF NOT EXISTS election_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES election_positions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  statement TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES admins(id),
  review_reason TEXT,
  withdrawn_at TEXT,
  UNIQUE(election_id,position_id,member_id)
);
CREATE INDEX IF NOT EXISTS idx_election_applications_review
  ON election_applications(election_id,status,position_id);


INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(31,'election_applications');

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(32,'election_application_notifications');
