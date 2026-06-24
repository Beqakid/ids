/**
 * Shared test helpers.
 * Runs both migrations against the test D1 database before tests.
 */
import { env } from "cloudflare:test";
import type { Env } from "../src/types/env";

let migrated = false;

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS ids_service_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_ids_apps_app_id ON ids_apps (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_apps_status ON ids_apps (status);
CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_event_type ON ids_audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_app_id ON ids_audit_logs (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_user_id ON ids_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_audit_logs_created_at ON ids_audit_logs (created_at);

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
`;

const MIGRATION_2 = `
CREATE TABLE IF NOT EXISTS ids_users (
  id               TEXT PRIMARY KEY,
  display_name     TEXT,
  avatar_url       TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  primary_email    TEXT,
  primary_phone    TEXT,
  email_verified   INTEGER NOT NULL DEFAULT 0,
  phone_verified   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at    TEXT
);

CREATE TABLE IF NOT EXISTS ids_user_emails (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  email               TEXT NOT NULL,
  normalized_email    TEXT NOT NULL,
  verified            INTEGER NOT NULL DEFAULT 0,
  is_primary          INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES ids_users(id)
);

CREATE TABLE IF NOT EXISTS ids_user_phones (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  phone               TEXT NOT NULL,
  normalized_phone    TEXT NOT NULL,
  verified            INTEGER NOT NULL DEFAULT 0,
  is_primary          INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES ids_users(id)
);

CREATE TABLE IF NOT EXISTS ids_sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  app_id             TEXT,
  ip_address         TEXT,
  user_agent         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT,
  last_seen_at       TEXT,
  FOREIGN KEY (user_id) REFERENCES ids_users(id)
);

CREATE TABLE IF NOT EXISTS ids_login_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  app_id      TEXT,
  event_type  TEXT NOT NULL,
  success     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  metadata    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ids_users_status ON ids_users (status);
CREATE INDEX IF NOT EXISTS idx_ids_users_primary_email ON ids_users (primary_email);
CREATE INDEX IF NOT EXISTS idx_ids_users_primary_phone ON ids_users (primary_phone);
CREATE INDEX IF NOT EXISTS idx_ids_user_emails_user_id ON ids_user_emails (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_emails_normalized_email ON ids_user_emails (normalized_email);
CREATE INDEX IF NOT EXISTS idx_ids_user_phones_user_id ON ids_user_phones (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_user_phones_normalized_phone ON ids_user_phones (normalized_phone);
CREATE INDEX IF NOT EXISTS idx_ids_sessions_user_id ON ids_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_sessions_status ON ids_sessions (status);
CREATE INDEX IF NOT EXISTS idx_ids_sessions_app_id ON ids_sessions (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_sessions_expires_at ON ids_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_ids_login_events_user_id ON ids_login_events (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_login_events_app_id ON ids_login_events (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_login_events_event_type ON ids_login_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ids_login_events_created_at ON ids_login_events (created_at);
`;

export async function ensureMigrations() {
  if (migrated) return;

  const db = (env as unknown as Env).IDS_DB;

  for (const migration of [MIGRATION_1, MIGRATION_2]) {
    for (const sql of migration.split(";")) {
      const trimmed = sql.trim();
      if (trimmed.length > 0) {
        await db.prepare(trimmed).run();
      }
    }
  }

  migrated = true;
}

/** Quick helper to make JSON requests. */
export function jsonRequest(
  path: string,
  method: string = "GET",
  body?: unknown
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}
