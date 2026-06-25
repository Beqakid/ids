-- Phase 5: Token Issuing, JWT Validation, Service API Keys, Internal Route Protection
-- Migration: 0005_token_route_protection.sql

-- ── ids_service_clients ──────────────────────────────────────
-- Trusted internal service clients allowed to call protected IDS internal routes.
-- Examples: command_center, kai, sms, carehia, viliniu, volau, local_dev
CREATE TABLE IF NOT EXISTS ids_service_clients (
  id              TEXT PRIMARY KEY,
  client_id       TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  app_id          TEXT,
  tenant_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  scopes          TEXT,
  allowed_origins TEXT,
  allowed_ips     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_used_at    TEXT,
  metadata        TEXT
);
-- Allowed statuses: active | suspended | revoked | archived

CREATE INDEX IF NOT EXISTS idx_ids_service_clients_client_id ON ids_service_clients (client_id);
CREATE INDEX IF NOT EXISTS idx_ids_service_clients_app_id ON ids_service_clients (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_service_clients_status ON ids_service_clients (status);

-- ── ids_service_api_keys ─────────────────────────────────────
-- Hashed service API keys for service-to-service authentication.
-- Raw key is NEVER stored — only the hash and a display prefix.
CREATE TABLE IF NOT EXISTS ids_service_api_keys (
  id                  TEXT PRIMARY KEY,
  service_client_id   TEXT NOT NULL,
  key_prefix          TEXT NOT NULL,
  key_hash            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  expires_at          TEXT,
  revoked_at          TEXT,
  last_used_at        TEXT,
  created_by_user_id  TEXT,
  metadata            TEXT,
  FOREIGN KEY (service_client_id) REFERENCES ids_service_clients(id)
);
-- Allowed statuses: active | revoked | expired

CREATE INDEX IF NOT EXISTS idx_ids_service_api_keys_service_client_id ON ids_service_api_keys (service_client_id);
CREATE INDEX IF NOT EXISTS idx_ids_service_api_keys_key_prefix ON ids_service_api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_ids_service_api_keys_status ON ids_service_api_keys (status);
CREATE INDEX IF NOT EXISTS idx_ids_service_api_keys_expires_at ON ids_service_api_keys (expires_at);

-- ── ids_token_events ─────────────────────────────────────────
-- Records JWT issuing, verification failures, token revocation, and exchange events.
CREATE TABLE IF NOT EXISTS ids_token_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  session_id  TEXT,
  app_id      TEXT,
  tenant_id   TEXT,
  token_type  TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  jti         TEXT,
  subject     TEXT,
  audience    TEXT,
  success     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT,
  created_at  TEXT NOT NULL
);
-- token_type: access | service | bootstrap
-- event_type: token_issued | token_exchange_attempt | token_exchange_failed |
--             token_verified | token_verify_failed | token_revoked | token_expired |
--             service_key_created | service_key_used | service_key_revoked | bootstrap_used

CREATE INDEX IF NOT EXISTS idx_ids_token_events_user_id ON ids_token_events (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_token_events_session_id ON ids_token_events (session_id);
CREATE INDEX IF NOT EXISTS idx_ids_token_events_app_id ON ids_token_events (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_token_events_event_type ON ids_token_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ids_token_events_jti ON ids_token_events (jti);
CREATE INDEX IF NOT EXISTS idx_ids_token_events_created_at ON ids_token_events (created_at);

-- ── ids_revoked_tokens ───────────────────────────────────────
-- Tracks revoked JWT IDs (jti) until their expiry for fast revocation checks.
CREATE TABLE IF NOT EXISTS ids_revoked_tokens (
  id          TEXT PRIMARY KEY,
  jti         TEXT UNIQUE NOT NULL,
  user_id     TEXT,
  session_id  TEXT,
  app_id      TEXT,
  tenant_id   TEXT,
  reason      TEXT,
  revoked_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ids_revoked_tokens_jti ON ids_revoked_tokens (jti);
CREATE INDEX IF NOT EXISTS idx_ids_revoked_tokens_user_id ON ids_revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_revoked_tokens_session_id ON ids_revoked_tokens (session_id);
CREATE INDEX IF NOT EXISTS idx_ids_revoked_tokens_expires_at ON ids_revoked_tokens (expires_at);

-- ── Optional: index on session_token_hash for fast lookup ────
-- (session_token_hash lookups are used in token exchange)
CREATE INDEX IF NOT EXISTS idx_ids_sessions_token_hash ON ids_sessions (session_token_hash);

UPDATE ids_service_metadata
  SET value = 'phase_5_token_route_protection', updated_at = datetime('now')
  WHERE key = 'phase';
