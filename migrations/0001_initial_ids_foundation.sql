-- ============================================================
-- IDS Phase 1 — Initial Foundation Migration
-- ============================================================
-- This migration creates the foundational tables for the
-- Shared Identity Service (IDS).
-- ============================================================

-- Service-level key/value metadata
CREATE TABLE IF NOT EXISTS ids_service_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Platform app registry
CREATE TABLE IF NOT EXISTS ids_apps (
  id              TEXT PRIMARY KEY,
  app_id          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  app_type        TEXT,
  status          TEXT NOT NULL DEFAULT 'planned',
  domain          TEXT,
  allowed_origins TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit log for all identity-related events
CREATE TABLE IF NOT EXISTS ids_audit_logs (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  app_id          TEXT,
  user_id         TEXT,
  tenant_id       TEXT,
  actor_user_id   TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ids_apps_app_id
  ON ids_apps (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_apps_status
  ON ids_apps (status);

CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_event_type
  ON ids_audit_logs (event_type);

CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_app_id
  ON ids_audit_logs (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_user_id
  ON ids_audit_logs (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_created_at
  ON ids_audit_logs (created_at);

-- ── Seed data ────────────────────────────────────────────────

INSERT OR IGNORE INTO ids_service_metadata (key, value)
VALUES
  ('service_name',    'ids'),
  ('display_name',    'Shared Identity Service'),
  ('version',         '0.1.0'),
  ('phase',           'phase_1_foundation');

INSERT OR IGNORE INTO ids_apps (id, app_id, name, status)
VALUES
  ('app_cc',  'command_center', 'Command Center',       'planned'),
  ('app_kai', 'kai',            'Kai',                   'planned'),
  ('app_sms', 'sms',            'Shared Media Service',  'planned'),
  ('app_car', 'carehia',        'Carehia',               'planned'),
  ('app_vil', 'viliniu',        'Viliniu',               'planned'),
  ('app_vol', 'volau',          'Volau',                 'planned');
