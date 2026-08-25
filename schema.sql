-- ============================================================================
-- Fund Management Bot — Cloudflare D1 Schema
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- subscribers: every user who has started the bot
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscribers (
  telegram_id INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  username    TEXT,
  joined_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ----------------------------------------------------------------------------
-- payments: submitted receipts, pending admin approval
-- reference_number has a STRICT UNIQUE constraint to prevent the same
-- transaction slip being submitted twice (double-spend / fraud protection).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id     INTEGER NOT NULL,
  amount            REAL NOT NULL,
  reference_number  TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processed_at      TEXT,
  FOREIGN KEY (subscriber_id) REFERENCES subscribers(telegram_id)
);

-- Historical / dashboard lookups
CREATE INDEX IF NOT EXISTS idx_payments_subscriber   ON payments(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_payments_status        ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_submitted_at  ON payments(submitted_at DESC);
-- Fast "this month" lookups per subscriber
CREATE INDEX IF NOT EXISTS idx_payments_sub_submitted ON payments(subscriber_id, submitted_at DESC);

-- ----------------------------------------------------------------------------
-- expenses: money spent out of the fund
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  amount       REAL NOT NULL,
  description  TEXT NOT NULL,
  incurred_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_expenses_incurred_at ON expenses(incurred_at DESC);
