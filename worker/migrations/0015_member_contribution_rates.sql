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

CREATE INDEX IF NOT EXISTS idx_member_contribution_rates_member_period
ON member_contribution_rates(member_id,effective_from,effective_to);

INSERT OR IGNORE INTO member_contribution_rates(member_id,amount,effective_from)
SELECT id,monthly_amount,
       COALESCE(NULLIF(substr(joined_at,1,7),''),NULLIF(substr(created_at,1,7),''),strftime('%Y-%m','now'))
FROM members;

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(15,'member_contribution_rate_history_and_member_app');
