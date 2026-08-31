-- Meeting notification timestamp for RSVP reminders and updates.
ALTER TABLE meetings ADD COLUMN last_notification_at TEXT;
