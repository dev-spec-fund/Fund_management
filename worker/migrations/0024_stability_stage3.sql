-- Stability Stage 3: mutation idempotency and financial-write guards.
ALTER TABLE expenses ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idempotency_key
ON expenses(idempotency_key)
WHERE idempotency_key IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES (24,'stability_stage3');
