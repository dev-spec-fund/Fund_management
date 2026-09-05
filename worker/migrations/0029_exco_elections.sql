
CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  term TEXT,
  opens_at TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed','cancelled')),
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  opened_at TEXT,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS election_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  max_selections INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS election_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES election_positions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
  UNIQUE(election_id,position_id,member_id)
);
CREATE TABLE IF NOT EXISTS election_voters (
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  voted_at TEXT,
  vote_claim TEXT,
  PRIMARY KEY(election_id,member_id)
);
CREATE TABLE IF NOT EXISTS election_ballots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  ballot_token TEXT NOT NULL,
  position_id INTEGER NOT NULL REFERENCES election_positions(id),
  candidate_id INTEGER NOT NULL REFERENCES election_candidates(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ballot_token,position_id,candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_election_ballots_election ON election_ballots(election_id,position_id,candidate_id);
CREATE INDEX IF NOT EXISTS idx_election_voters_election ON election_voters(election_id,voted_at);
INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(29,'exco_elections');
