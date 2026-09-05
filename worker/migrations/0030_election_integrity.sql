-- Election integrity, certification and withdrawal controls.
ALTER TABLE elections ADD COLUMN certified_at TEXT;
ALTER TABLE elections ADD COLUMN certified_by INTEGER REFERENCES admins(id);

ALTER TABLE election_positions ADD COLUMN min_selections INTEGER NOT NULL DEFAULT 1;

ALTER TABLE election_candidates ADD COLUMN withdrawn_at TEXT;
ALTER TABLE election_candidates ADD COLUMN withdrawn_by INTEGER REFERENCES admins(id);
ALTER TABLE election_candidates ADD COLUMN withdrawal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_elections_lifecycle
  ON elections(status, opens_at, closes_at);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(30,'election_integrity');
