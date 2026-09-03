-- Custom admin roles and permission assignments.
CREATE TABLE IF NOT EXISTS admin_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
  role_id INTEGER NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY(role_id, permission)
);

ALTER TABLE admins ADD COLUMN custom_role_id INTEGER REFERENCES admin_roles(id);

CREATE INDEX IF NOT EXISTS idx_admins_custom_role ON admins(custom_role_id, active);
CREATE INDEX IF NOT EXISTS idx_admin_role_permissions_role ON admin_role_permissions(role_id);

INSERT OR IGNORE INTO schema_migrations(version,name) VALUES (21,'custom_admin_roles');
