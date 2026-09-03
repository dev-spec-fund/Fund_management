-- Stability Stage 5: Telegram webhook/update idempotency.
CREATE TABLE IF NOT EXISTS telegram_update_receipts (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','completed','failed')),
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_update_receipts_status_claimed
ON telegram_update_receipts(status, claimed_at);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES (25,'telegram_update_idempotency');
