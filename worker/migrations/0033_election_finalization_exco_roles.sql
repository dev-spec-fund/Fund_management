-- Runoff voting and certified EXCO role assignments.
CREATE TABLE IF NOT EXISTS election_runoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES election_positions(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL DEFAULT 1,
  seats_to_fill INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
  opens_at TEXT,
  closes_at TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  created_by INTEGER REFERENCES admins(id),
  UNIQUE(election_id,position_id,round_no)
);

CREATE TABLE IF NOT EXISTS election_runoff_candidates (
  runoff_id INTEGER NOT NULL REFERENCES election_runoffs(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES election_candidates(id),
  PRIMARY KEY(runoff_id,candidate_id)
);

CREATE TABLE IF NOT EXISTS election_runoff_voters (
  runoff_id INTEGER NOT NULL REFERENCES election_runoffs(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  voted_at TEXT,
  vote_claim TEXT,
  PRIMARY KEY(runoff_id,member_id)
);

CREATE TABLE IF NOT EXISTS election_runoff_ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runoff_id INTEGER NOT NULL REFERENCES election_runoffs(id) ON DELETE CASCADE,
  ballot_token TEXT NOT NULL,
  candidate_id INTEGER NOT NULL REFERENCES election_candidates(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ballot_token,candidate_id)
);

CREATE TABLE IF NOT EXISTS exco_role_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  election_id INTEGER NOT NULL REFERENCES elections(id),
  position_id INTEGER NOT NULL REFERENCES election_positions(id),
  role_title TEXT NOT NULL,
  term TEXT,
  started_at TEXT NOT NULL DEFAULT (date('now')),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(election_id,position_id,member_id)
);

CREATE INDEX IF NOT EXISTS idx_election_runoffs_election ON election_runoffs(election_id,position_id,status);
CREATE INDEX IF NOT EXISTS idx_exco_roles_current ON exco_role_assignments(member_id,ended_at);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(33,'election_finalization_exco_roles');
