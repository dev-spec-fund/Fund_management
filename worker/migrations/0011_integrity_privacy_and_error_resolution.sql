-- Integrity/privacy hardening: atomic contribution duplicate protection and resolvable error history.
ALTER TABLE contributions ADD COLUMN duplicate_key TEXT;

-- Backfill one canonical duplicate key per currently-live reference/amount/date combination.
-- Historical duplicate rows remain readable; future inserts for the same key are blocked.
WITH normalized AS (
  SELECT
    id,
    UPPER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(ref_number,''),' ',''),'-',''),'/',''),'.',''),'_',''),':','')) AS nref,
    CAST(ROUND(amount * 100) AS INTEGER) AS minor,
    COALESCE(NULLIF(bank_date,''), substr(submitted_at,1,10)) AS d
  FROM contributions
  WHERE status NOT IN ('rejected','voided') AND TRIM(COALESCE(ref_number,'')) <> ''
), canonical AS (
  SELECT MIN(id) id, nref || '|' || minor || '|' || d AS duplicate_key
  FROM normalized
  WHERE nref <> ''
  GROUP BY nref, minor, d
)
UPDATE contributions
SET duplicate_key=(SELECT canonical.duplicate_key FROM canonical WHERE canonical.id=contributions.id)
WHERE id IN (SELECT id FROM canonical);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contributions_live_duplicate_key
  ON contributions(duplicate_key)
  WHERE duplicate_key IS NOT NULL AND status NOT IN ('rejected','voided');
CREATE INDEX IF NOT EXISTS idx_contributions_duplicate_lookup
  ON contributions(duplicate_key,status);

ALTER TABLE error_log ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE error_log ADD COLUMN resolved_at TEXT;
ALTER TABLE error_log ADD COLUMN resolved_by INTEGER REFERENCES admins(id);
CREATE INDEX IF NOT EXISTS idx_error_log_status_created ON error_log(status,created_at DESC);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (11,'integrity_privacy_and_error_resolution');
