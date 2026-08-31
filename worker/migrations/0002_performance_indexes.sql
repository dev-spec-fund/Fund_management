CREATE INDEX IF NOT EXISTS idx_members_telegram_active ON members(telegram_id, active);
CREATE INDEX IF NOT EXISTS idx_admins_telegram_active_role ON admins(telegram_id, active, role);
CREATE INDEX IF NOT EXISTS idx_contributions_status_month_member ON contributions(status, month, member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status_approved_at ON contributions(status, approved_at);
CREATE INDEX IF NOT EXISTS idx_expenses_status_created ON expenses(status, created_at);
CREATE INDEX IF NOT EXISTS idx_donations_status_created ON donations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_registrations_status_requested ON member_registration_requests(status, requested_at);
