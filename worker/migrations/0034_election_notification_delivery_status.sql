-- Election notification delivery audit/status.
CREATE TABLE IF NOT EXISTS election_notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  audience TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_election_notification_log
  ON election_notification_log(election_id,created_at DESC,id DESC);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(34,'election_notification_delivery_status');
