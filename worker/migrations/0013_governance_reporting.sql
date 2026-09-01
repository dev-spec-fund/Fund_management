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

DROP INDEX IF EXISTS idx_contributions_live_duplicate_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_live_duplicate_key
ON contributions(duplicate_key)
WHERE duplicate_key IS NOT NULL AND status NOT IN ('rejected','voided','reversed');

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (13,'governance_reporting_and_reversals');
