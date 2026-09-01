ALTER TABLE expenses ADD COLUMN expense_date TEXT;

UPDATE expenses
SET expense_date = CASE
  WHEN transaction_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' THEN transaction_month || '-01'
  ELSE substr(created_at,1,10)
END
WHERE expense_date IS NULL OR expense_date='';

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON expenses(expense_date);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (14,'expense_dates_and_financial_integrity');
