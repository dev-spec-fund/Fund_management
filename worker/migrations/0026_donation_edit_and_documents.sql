-- Donation editing + supporting documents.
ALTER TABLE donations ADD COLUMN donation_date TEXT;
ALTER TABLE donations ADD COLUMN edited_by INTEGER REFERENCES admins(id);
ALTER TABLE donations ADD COLUMN updated_at TEXT;
ALTER TABLE donations ADD COLUMN idempotency_key TEXT;

UPDATE donations
SET donation_date=COALESCE(NULLIF(donation_date,''),substr(created_at,1,10))
WHERE donation_date IS NULL OR donation_date='';

CREATE UNIQUE INDEX IF NOT EXISTS idx_donations_idempotency_key
ON donations(idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS donation_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  donation_id INTEGER NOT NULL REFERENCES donations(id),
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  telegram_message_id INTEGER,
  telegram_chat_id TEXT,
  original_filename TEXT NOT NULL,
  display_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  document_type TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_by INTEGER REFERENCES admins(id),
  removal_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_donation_documents_active
ON donation_documents(donation_id,removed_at,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donation_documents_telegram_file
ON donation_documents(telegram_file_id);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES (26,'donation_edit_and_documents');
