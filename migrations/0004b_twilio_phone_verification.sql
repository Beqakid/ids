-- Migration 0004b: Twilio Phone Verification
-- Phase 4B — Adds verification events and phone verification attempts tables.

-- ── Verification Events ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ids_verification_events (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  app_id                TEXT,
  tenant_id             TEXT,
  verification_type     TEXT NOT NULL,
  provider              TEXT NOT NULL,
  provider_reference_id TEXT,
  target                TEXT NOT NULL,
  normalized_target     TEXT NOT NULL,
  status                TEXT NOT NULL,
  reason                TEXT,
  metadata              TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES ids_users(id)
);

CREATE INDEX IF NOT EXISTS idx_ids_verification_events_user_id ON ids_verification_events (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_app_id ON ids_verification_events (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_tenant_id ON ids_verification_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_type ON ids_verification_events (verification_type);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_provider ON ids_verification_events (provider);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_status ON ids_verification_events (status);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_normalized_target ON ids_verification_events (normalized_target);
CREATE INDEX IF NOT EXISTS idx_ids_verification_events_created_at ON ids_verification_events (created_at);

-- ── Phone Verification Attempts ──────────────────────────────
CREATE TABLE IF NOT EXISTS ids_phone_verification_attempts (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  phone_id                 TEXT,
  app_id                   TEXT,
  tenant_id                TEXT,
  normalized_phone         TEXT NOT NULL,
  provider                 TEXT NOT NULL DEFAULT 'twilio',
  provider_verification_sid TEXT,
  status                   TEXT NOT NULL,
  channel                  TEXT NOT NULL DEFAULT 'sms',
  attempt_count            INTEGER NOT NULL DEFAULT 1,
  ip_address               TEXT,
  user_agent               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at               TEXT,
  last_checked_at          TEXT,
  metadata                 TEXT,
  FOREIGN KEY (user_id) REFERENCES ids_users(id)
);

CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_user_id ON ids_phone_verification_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_phone_id ON ids_phone_verification_attempts (phone_id);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_app_id ON ids_phone_verification_attempts (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_tenant_id ON ids_phone_verification_attempts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_normalized_phone ON ids_phone_verification_attempts (normalized_phone);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_status ON ids_phone_verification_attempts (status);
CREATE INDEX IF NOT EXISTS idx_ids_phone_verification_attempts_created_at ON ids_phone_verification_attempts (created_at);

-- ── Update phase ─────────────────────────────────────────────
UPDATE ids_service_metadata
  SET value = 'phase_4b_twilio_phone_verification', updated_at = datetime('now')
  WHERE key = 'phase';