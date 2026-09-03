-- Expense approval workflow removed by product decision.
-- Existing pending expenses become normal approved expenses owned by their logger.
UPDATE expenses
SET status='approved',
    approved_by=COALESCE(approved_by,logged_by),
    approved_at=COALESCE(approved_at,created_at,datetime('now')),
    approval_required=0
WHERE status='pending';

DELETE FROM settings WHERE key='expense_approval_threshold';

ALTER TABLE expenses DROP COLUMN approval_required;

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (22,'remove_expense_approval_workflow');
