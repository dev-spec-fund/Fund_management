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
