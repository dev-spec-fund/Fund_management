-- Production compatibility migration for databases created before admin lifecycle hardening.
-- Run ONCE against the remote D1 database before deploying this patch.
ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admins ADD COLUMN deactivated_at TEXT;
ALTER TABLE admins ADD COLUMN deactivated_by INTEGER REFERENCES admins(id);

CREATE INDEX IF NOT EXISTS idx_admins_telegram_active_role ON admins(telegram_id, active, role);
CREATE INDEX IF NOT EXISTS idx_contributions_status_month_member ON contributions(status, month, member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status_approved_at ON contributions(status, approved_at);
CREATE INDEX IF NOT EXISTS idx_expenses_status_created ON expenses(status, created_at);
CREATE INDEX IF NOT EXISTS idx_donations_status_created ON donations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_registrations_status_requested ON member_registration_requests(status, requested_at);
