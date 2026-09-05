-- EXCO responsibilities and committee workboard.
CREATE TABLE IF NOT EXISTS exco_responsibilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id INTEGER NOT NULL REFERENCES exco_terms(id) ON DELETE CASCADE,
  owner_member_id INTEGER REFERENCES members(id),
  owner_role_title TEXT,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','completed')),
  completed_at TEXT,
  created_by INTEGER REFERENCES admins(id),
  updated_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS exco_responsibility_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  responsibility_id INTEGER NOT NULL REFERENCES exco_responsibilities(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  admin_id INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exco_responsibilities_term_status
  ON exco_responsibilities(term_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_exco_responsibility_history_item
  ON exco_responsibility_history(responsibility_id,id DESC);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(36,'exco_responsibilities_workboard');
