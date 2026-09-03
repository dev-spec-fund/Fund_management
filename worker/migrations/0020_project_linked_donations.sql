-- v20: Optional project link for donations
ALTER TABLE donations ADD COLUMN project_id INTEGER REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_donations_project_status_month ON donations(project_id,status,transaction_month);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (20,'project_linked_donations');
