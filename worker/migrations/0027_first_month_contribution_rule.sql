-- Configurable first-month contribution policy.
INSERT OR IGNORE INTO settings(key,value)
VALUES('first_month_contribution_rule','half_after_15');

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(27,'first_month_contribution_rule');
