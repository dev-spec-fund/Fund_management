-- EXCO term management, handover records and checklist.
CREATE TABLE IF NOT EXISTS exco_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL UNIQUE REFERENCES elections(id),
  term_label TEXT,
  status TEXT NOT NULL DEFAULT 'current' CHECK(status IN ('current','completed')),
  started_at TEXT NOT NULL DEFAULT (date('now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exco_handover_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incoming_term_id INTEGER NOT NULL UNIQUE REFERENCES exco_terms(id) ON DELETE CASCADE,
  outgoing_term_id INTEGER REFERENCES exco_terms(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
  notes TEXT,
  completed_at TEXT,
  completed_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS exco_handover_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handover_id INTEGER NOT NULL REFERENCES exco_handover_records(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by INTEGER REFERENCES admins(id),
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(handover_id,item_key)
);

CREATE INDEX IF NOT EXISTS idx_exco_terms_status ON exco_terms(status,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exco_handover_items_handover ON exco_handover_items(handover_id,sort_order,id);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(35,'exco_term_handover_management');
