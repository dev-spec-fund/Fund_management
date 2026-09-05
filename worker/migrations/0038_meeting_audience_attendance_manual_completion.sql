-- Meeting audience, invitation snapshot, manual completion and attendance.
ALTER TABLE meetings ADD COLUMN audience TEXT NOT NULL DEFAULT 'all_members';
ALTER TABLE meetings ADD COLUMN completed_at TEXT;
ALTER TABLE meetings ADD COLUMN completed_by INTEGER REFERENCES admins(id);

CREATE TABLE IF NOT EXISTS meeting_invitees (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(meeting_id,member_id)
);

CREATE TABLE IF NOT EXISTS meeting_attendance (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  attendance TEXT NOT NULL CHECK(attendance IN ('present','absent','excused','late')),
  note TEXT,
  recorded_by INTEGER NOT NULL REFERENCES admins(id),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(meeting_id,member_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_invitees_meeting ON meeting_invitees(meeting_id,member_id);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting ON meeting_attendance(meeting_id,attendance);

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(38,'meeting_audience_attendance_manual_completion');
