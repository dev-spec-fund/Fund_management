-- Election candidate eligibility and application reminder controls.
ALTER TABLE elections ADD COLUMN min_membership_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE elections ADD COLUMN require_good_standing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE elections ADD COLUMN application_reminder_sent_at TEXT;

ALTER TABLE election_positions ADD COLUMN min_membership_days INTEGER;
ALTER TABLE election_positions ADD COLUMN require_good_standing INTEGER;

CREATE INDEX IF NOT EXISTS idx_elections_application_reminders
  ON elections(status, applications_open_at, applications_close_at, application_reminder_sent_at);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(32,'election_application_eligibility');
