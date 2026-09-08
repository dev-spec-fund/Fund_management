-- Election positions linked to Admin Roles and election-driven admin access.
-- Apply manually to D1 before deploying worker code that requires schema version 39.

CREATE TABLE IF NOT EXISTS election_position_admin_roles (
  position_id INTEGER PRIMARY KEY REFERENCES election_positions(id) ON DELETE CASCADE,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  role_kind TEXT NOT NULL CHECK(role_kind IN ('builtin','custom')),
  builtin_role TEXT,
  custom_role_id INTEGER REFERENCES admin_roles(id),
  role_name_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_election_position_admin_roles_election
  ON election_position_admin_roles(election_id,position_id);

CREATE TABLE IF NOT EXISTS election_admin_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES election_positions(id),
  member_id INTEGER NOT NULL REFERENCES members(id),
  role_kind TEXT NOT NULL CHECK(role_kind IN ('builtin','custom')),
  builtin_role TEXT,
  custom_role_id INTEGER REFERENCES admin_roles(id),
  role_name_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),
  activated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  UNIQUE(election_id,position_id,member_id)
);

CREATE INDEX IF NOT EXISTS idx_election_admin_assignments_status
  ON election_admin_assignments(status,election_id);

-- Backfill legacy election positions only when the title exactly matches an
-- eligible built-in Admin Role. Super Admin is intentionally excluded.
INSERT OR IGNORE INTO election_position_admin_roles
  (position_id,election_id,role_kind,builtin_role,custom_role_id,role_name_snapshot)
SELECT p.id,p.election_id,'builtin',
  CASE lower(trim(p.title))
    WHEN 'president' THEN 'president'
    WHEN 'treasurer' THEN 'treasurer'
    WHEN 'secretary' THEN 'secretary'
    WHEN 'viewer' THEN 'viewer'
  END,
  NULL,p.title
FROM election_positions p
WHERE lower(trim(p.title)) IN ('president','treasurer','secretary','viewer');

-- Backfill exact matches to currently active custom roles.
INSERT OR IGNORE INTO election_position_admin_roles
  (position_id,election_id,role_kind,builtin_role,custom_role_id,role_name_snapshot)
SELECT p.id,p.election_id,'custom',NULL,r.id,p.title
FROM election_positions p
JOIN admin_roles r ON lower(trim(r.name))=lower(trim(p.title))
WHERE COALESCE(r.active,1)=1;

INSERT OR IGNORE INTO schema_migrations(version,name)
VALUES(39,'election_admin_role_linking');
