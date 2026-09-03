ALTER TABLE expense_documents ADD COLUMN display_name TEXT;
ALTER TABLE expense_documents ADD COLUMN removed_at TEXT;
ALTER TABLE expense_documents ADD COLUMN removed_by INTEGER REFERENCES admins(id);
ALTER TABLE expense_documents ADD COLUMN removal_reason TEXT;
UPDATE expense_documents SET display_name=original_filename WHERE display_name IS NULL OR trim(display_name)='';
CREATE INDEX IF NOT EXISTS idx_expense_documents_active ON expense_documents(expense_id, removed_at, created_at DESC);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (19,'expense_document_management');
