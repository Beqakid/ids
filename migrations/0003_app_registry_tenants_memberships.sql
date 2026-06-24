-- ============================================================
-- IDS Phase 3 — App Registry, Tenants, and Memberships
-- ============================================================
-- Extends the app registry with full fields, adds tenants
-- and memberships, and introduces app access logging.
-- ============================================================

-- ── A. Extend ids_apps ───────────────────────────────────────
-- ids_apps already exists from Phase 1.  Add missing columns.

ALTER TABLE ids_apps ADD COLUMN description TEXT;

-- Add the app_type index (app_id and status indexes already exist from Phase 1)
CREATE INDEX IF NOT EXISTS idx_ids_apps_app_type
  ON ids_apps (app_type);

-- Update seeded apps with proper types and statuses
UPDATE ids_apps SET app_type = 'admin',       status = 'active',  updated_at = datetime('now') WHERE app_id = 'command_center';
UPDATE ids_apps SET app_type = 'ai',          status = 'active',  updated_at = datetime('now') WHERE app_id = 'kai';
UPDATE ids_apps SET app_type = 'media',       status = 'active',  updated_at = datetime('now') WHERE app_id = 'sms';
UPDATE ids_apps SET app_type = 'marketplace', status = 'planned', updated_at = datetime('now') WHERE app_id = 'carehia';
UPDATE ids_apps SET app_type = 'marketplace', status = 'planned', updated_at = datetime('now') WHERE app_id = 'viliniu';
UPDATE ids_apps SET app_type = 'knowledge',   status = 'planned', updated_at = datetime('now') WHERE app_id = 'volau';

-- ── B. Create ids_tenants ────────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_tenants (
  id              TEXT PRIMARY KEY,
  app_id          TEXT NOT NULL,
  tenant_key      TEXT NOT NULL,
  name            TEXT NOT NULL,
  tenant_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  owner_user_id   TEXT,
  domain          TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES ids_apps(app_id),
  FOREIGN KEY (owner_user_id) REFERENCES ids_users(id)
);

-- Unique: same app cannot have duplicate tenant keys
CREATE UNIQUE INDEX IF NOT EXISTS idx_ids_tenants_app_tenant_key
  ON ids_tenants (app_id, tenant_key);

CREATE INDEX IF NOT EXISTS idx_ids_tenants_app_id
  ON ids_tenants (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_tenants_tenant_key
  ON ids_tenants (tenant_key);

CREATE INDEX IF NOT EXISTS idx_ids_tenants_status
  ON ids_tenants (status);

CREATE INDEX IF NOT EXISTS idx_ids_tenants_owner_user_id
  ON ids_tenants (owner_user_id);

-- ── C. Create ids_memberships ────────────────────────────────

CREATE TABLE IF NOT EXISTS ids_memberships (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  app_id             TEXT NOT NULL,
  tenant_id          TEXT NOT NULL,
  role_key           TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  invited_by_user_id TEXT,
  joined_at          TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  metadata           TEXT,
  FOREIGN KEY (user_id) REFERENCES ids_users(id),
  FOREIGN KEY (tenant_id) REFERENCES ids_tenants(id),
  FOREIGN KEY (app_id) REFERENCES ids_apps(app_id),
  FOREIGN KEY (invited_by_user_id) REFERENCES ids_users(id)
);

-- Unique: user + tenant + role_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_ids_memberships_user_tenant_role
  ON ids_memberships (user_id, tenant_id, role_key);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_user_id
  ON ids_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_app_id
  ON ids_memberships (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_tenant_id
  ON ids_memberships (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_role_key
  ON ids_memberships (role_key);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_status
  ON ids_memberships (status);

CREATE INDEX IF NOT EXISTS idx_ids_memberships_user_tenant
  ON ids_memberships (user_id, tenant_id);

-- ── D. Create ids_app_access_logs ────────────────────────────

CREATE TABLE IF NOT EXISTS ids_app_access_logs (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  user_id     TEXT,
  tenant_id   TEXT,
  event_type  TEXT NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ids_app_access_logs_app_id
  ON ids_app_access_logs (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_app_access_logs_user_id
  ON ids_app_access_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_app_access_logs_tenant_id
  ON ids_app_access_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ids_app_access_logs_event_type
  ON ids_app_access_logs (event_type);

CREATE INDEX IF NOT EXISTS idx_ids_app_access_logs_created_at
  ON ids_app_access_logs (created_at);

-- ── Update service metadata ─────────────────────────────────

UPDATE ids_service_metadata
  SET value = 'phase_3_app_tenants_memberships', updated_at = datetime('now')
  WHERE key = 'phase';
