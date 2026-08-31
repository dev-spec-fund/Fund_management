CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  meeting_time TEXT NOT NULL,
  venue TEXT,
  agenda TEXT,
  rsvp_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS meeting_rsvps (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')),
  responded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(meeting_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date, meeting_time);
CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_meeting ON meeting_rsvps(meeting_id);
