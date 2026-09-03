-- Performance Stage 2: indexes aligned with the app's hottest read paths
-- plus a database-level guard against duplicate financial reversals.

-- Common member lists are ordered by name.
CREATE INDEX IF NOT EXISTS idx_members_active_name
ON members(active, name);

-- Active donation queries currently preserve compatibility with legacy NULL status.
-- Expression indexes let SQLite use the same COALESCE expression used by the routes.
CREATE INDEX IF NOT EXISTS idx_donations_active_month
ON donations(COALESCE(status,'active'), transaction_month);

CREATE INDEX IF NOT EXISTS idx_donations_project_active_month_created
ON donations(project_id, COALESCE(status,'active'), transaction_month, created_at DESC);

-- Reports and project screens repeatedly filter approved expenses by month/project.
CREATE INDEX IF NOT EXISTS idx_expenses_month_status_date
ON expenses(transaction_month, status, expense_date, id);

CREATE INDEX IF NOT EXISTS idx_expenses_project_status_date
ON expenses(project_id, status, expense_date, id);

-- Recent audit/system views.
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
ON audit_log(action, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
ON audit_log(created_at DESC, id DESC);

-- Reversal lists are ordered by created_at and reversal lookup must be unique.
CREATE INDEX IF NOT EXISTS idx_financial_reversals_created
ON financial_reversals(created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_reversals_entity_unique
ON financial_reversals(entity_type, entity_id);

-- Meeting/report lookups commonly filter by meeting date and then join minutes/actions.
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting
ON meeting_minutes(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_status_due
ON meeting_action_items(status, due_date, meeting_id);
