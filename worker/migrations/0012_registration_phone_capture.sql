-- v12: capture the Telegram user's explicitly shared phone number during member registration.
ALTER TABLE member_registration_requests ADD COLUMN phone TEXT;

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES (12,'registration_phone_capture');
