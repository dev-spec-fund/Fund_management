-- Performance + normalized member lookup migration.
ALTER TABLE members ADD COLUMN normalized_name TEXT;
ALTER TABLE members ADD COLUMN normalized_phone TEXT;

UPDATE members
SET normalized_name = lower(trim(replace(replace(replace(name,'.',' '),'-',' '),'_',' '))),
    normalized_phone = replace(replace(replace(replace(replace(COALESCE(phone,''),' ',''),'-',''),'(',''),')',''),'+960','');

-- Backfill legacy month columns so indexed month filters do not need COALESCE/strftime.
UPDATE expenses SET transaction_month=strftime('%Y-%m',created_at) WHERE transaction_month IS NULL OR transaction_month='';
UPDATE donations SET transaction_month=strftime('%Y-%m',created_at) WHERE transaction_month IS NULL OR transaction_month='';

CREATE INDEX IF NOT EXISTS idx_members_normalized_name ON members(normalized_name);
CREATE INDEX IF NOT EXISTS idx_members_normalized_phone ON members(normalized_phone);
CREATE INDEX IF NOT EXISTS idx_allocations_member_month_contribution ON contribution_allocations(member_id,month,contribution_id);
CREATE INDEX IF NOT EXISTS idx_allocations_month_contribution ON contribution_allocations(month,contribution_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_member_month ON exemptions(member_id,month);
CREATE INDEX IF NOT EXISTS idx_month_closures_month ON month_closures(month);
CREATE INDEX IF NOT EXISTS idx_expenses_status_transaction_month_category ON expenses(status,transaction_month,category_id);
CREATE INDEX IF NOT EXISTS idx_donations_status_transaction_month ON donations(status,transaction_month);
CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting_member ON meeting_rsvps(meeting_id,member_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status_date ON meetings(status,meeting_date);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (10,'performance_and_normalized_members');
