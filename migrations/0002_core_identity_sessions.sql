-- ============================================================
-- IDS Phase 2 — Core User Identity + Sessions
-- ============================================================
-- Introduces master user records, user emails, user phones,
-- sessions, and login events.
-- ============================================================

-- Master user records
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

-- User email addresses (supports multiple per user)
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

-- User phone numbers (supports multiple per user)
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

-- User sessions
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

-- Login / session lifecycle events
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

-- ── Indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ids_users_status
  ON ids_users (status);

CREATE INDEX IF NOT EXISTS idx_ids_users_primary_email
  ON ids_users (primary_email);

CREATE INDEX IF NOT EXISTS idx_ids_users_primary_phone
  ON ids_users (primary_phone);

CREATE INDEX IF NOT EXISTS idx_ids_user_emails_user_id
  ON ids_user_emails (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_user_emails_normalized_email
  ON ids_user_emails (normalized_email);

CREATE INDEX IF NOT EXISTS idx_ids_user_phones_user_id
  ON ids_user_phones (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_user_phones_normalized_phone
  ON ids_user_phones (normalized_phone);

CREATE INDEX IF NOT EXISTS idx_ids_sessions_user_id
  ON ids_sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_sessions_status
  ON ids_sessions (status);

CREATE INDEX IF NOT EXISTS idx_ids_sessions_app_id
  ON ids_sessions (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_sessions_expires_at
  ON ids_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_ids_login_events_user_id
  ON ids_login_events (user_id);

CREATE INDEX IF NOT EXISTS idx_ids_login_events_app_id
  ON ids_login_events (app_id);

CREATE INDEX IF NOT EXISTS idx_ids_login_events_event_type
  ON ids_login_events (event_type);

CREATE INDEX IF NOT EXISTS idx_ids_login_events_created_at
  ON ids_login_events (created_at);

-- ── Update service metadata ─────────────────────────────────

UPDATE ids_service_metadata
  SET value = 'phase_2_core_identity', updated_at = datetime('now')
  WHERE key = 'phase';
