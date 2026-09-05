-- Candidate application Telegram notification tracking.
ALTER TABLE elections ADD COLUMN applications_notified_at TEXT;
ALTER TABLE elections ADD COLUMN applications_reminder_at TEXT;

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(32,'election_application_notifications');
