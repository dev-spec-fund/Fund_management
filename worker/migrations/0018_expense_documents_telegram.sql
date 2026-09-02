CREATE TABLE IF NOT EXISTS expense_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id),
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  telegram_message_id INTEGER,
  telegram_chat_id TEXT,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  document_type TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_expense_documents_expense_created ON expense_documents(expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_documents_telegram_file ON expense_documents(telegram_file_id);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (18,'expense_documents_telegram');
