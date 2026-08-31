-- Meeting editing, rescheduling and cancellation lifecycle.
ALTER TABLE meetings ADD COLUMN updated_at TEXT;
ALTER TABLE meetings ADD COLUMN cancelled_at TEXT;
ALTER TABLE meetings ADD COLUMN cancelled_by INTEGER REFERENCES admins(id);
ALTER TABLE meetings ADD COLUMN cancel_reason TEXT;
