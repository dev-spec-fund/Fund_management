-- Track Telegram admin review messages so Mini App and bot decisions stay synchronized.
CREATE TABLE IF NOT EXISTS contribution_review_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id INTEGER NOT NULL REFERENCES contributions(id),
  admin_telegram_id TEXT,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  message_kind TEXT NOT NULL DEFAULT 'photo' CHECK(message_kind IN ('photo','text')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_synced_at TEXT,
  last_sync_status TEXT,
  UNIQUE(telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS idx_contribution_review_messages_contribution
  ON contribution_review_messages(contribution_id, created_at);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(28,'contribution_review_messages');
