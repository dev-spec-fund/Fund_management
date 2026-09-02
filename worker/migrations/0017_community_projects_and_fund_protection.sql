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
ALTER TABLE expenses ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE expenses ADD COLUMN fund_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN fund_override_reason TEXT;
ALTER TABLE expenses ADD COLUMN fund_override_by INTEGER REFERENCES admins(id);
ALTER TABLE expenses ADD COLUMN fund_override_at TEXT;
ALTER TABLE expenses ADD COLUMN fund_balance_before REAL;
ALTER TABLE expenses ADD COLUMN budget_override_reason TEXT;
ALTER TABLE expenses ADD COLUMN budget_override_by INTEGER REFERENCES admins(id);
CREATE INDEX IF NOT EXISTS idx_projects_status_start ON projects(status,start_date);
CREATE INDEX IF NOT EXISTS idx_expenses_project_status ON expenses(project_id,status,transaction_month);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(17,'community_projects_and_fund_protection');
