-- Formal meeting resolutions linked to EXCO terms and optional workboard follow-up.
CREATE TABLE IF NOT EXISTS meeting_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  term_id INTEGER NOT NULL REFERENCES exco_terms(id),
  resolution_no TEXT,
  title TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  proposer_member_id INTEGER REFERENCES members(id),
  seconder_member_id INTEGER REFERENCES members(id),
  vote_result TEXT,
  status TEXT NOT NULL DEFAULT 'adopted' CHECK(status IN ('draft','adopted','rejected','superseded')),
  responsibility_id INTEGER REFERENCES exco_responsibilities(id),
  created_by INTEGER REFERENCES admins(id),
  updated_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS meeting_resolution_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resolution_id INTEGER NOT NULL REFERENCES meeting_resolutions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  admin_id INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meeting_resolutions_meeting
  ON meeting_resolutions(meeting_id,id);
CREATE INDEX IF NOT EXISTS idx_meeting_resolutions_term
  ON meeting_resolutions(term_id,status,id);
CREATE INDEX IF NOT EXISTS idx_meeting_resolution_history
  ON meeting_resolution_history(resolution_id,id DESC);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(37,'meeting_resolutions_exco_terms');
