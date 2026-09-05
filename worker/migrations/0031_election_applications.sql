-- Candidate self-application / nomination stage.
ALTER TABLE elections ADD COLUMN applications_open_at TEXT;
ALTER TABLE elections ADD COLUMN applications_close_at TEXT;

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
