-- Run ONCE after migrations 0002 through 0008.
-- From this version onward the Worker validates schema version instead of ALTERing tables during requests.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (9,'hardening_and_schema_versioning');
