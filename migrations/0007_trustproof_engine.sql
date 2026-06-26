-- Phase 7: TrustProof Engine Foundation
-- Creates the core TrustProof receipt, timeline, proof link, verification, and counter tables.
-- This is IDS-side only. No external app repos are modified.

-- ── A. ids_trust_receipts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ids_trust_receipts (
  id                    TEXT PRIMARY KEY,
  receipt_number        TEXT UNIQUE NOT NULL,
  receipt_type          TEXT NOT NULL,
  source_app_id         TEXT NOT NULL,
  source_tenant_id      TEXT,
  user_id               TEXT,
  actor_user_id         TEXT,
  subject_user_id       TEXT,
  action_context_id     TEXT,
  envelope_id           TEXT,
  action_key            TEXT,
  action_label          TEXT,
  action_type           TEXT,
  risk_level            TEXT NOT NULL DEFAULT 'low',
  status                TEXT NOT NULL DEFAULT 'draft',
  outcome               TEXT,
  summary               TEXT NOT NULL,
  public_summary        TEXT,
  metadata              TEXT,
  private_metadata      TEXT,
  receipt_hash          TEXT NOT NULL,
  previous_receipt_hash TEXT,
  content_hash          TEXT,
  verification_status   TEXT NOT NULL DEFAULT 'valid',
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  finalized_at          TEXT,
  expires_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_receipt_number
  ON ids_trust_receipts (receipt_number);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_receipt_type
  ON ids_trust_receipts (receipt_type);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_source_app_id
  ON ids_trust_receipts (source_app_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_source_tenant_id
  ON ids_trust_receipts (source_tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_user_id
  ON ids_trust_receipts (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_actor_user_id
  ON ids_trust_receipts (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_subject_user_id
  ON ids_trust_receipts (subject_user_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_action_context_id
  ON ids_trust_receipts (action_context_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_envelope_id
  ON ids_trust_receipts (envelope_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_risk_level
  ON ids_trust_receipts (risk_level);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_status
  ON ids_trust_receipts (status);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_outcome
  ON ids_trust_receipts (outcome);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_verification_status
  ON ids_trust_receipts (verification_status);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_created_at
  ON ids_trust_receipts (created_at);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipts_finalized_at
  ON ids_trust_receipts (finalized_at);

-- ── B. ids_trust_receipt_events ──────────────────────────────
-- Timeline events for each TrustProof receipt.
CREATE TABLE IF NOT EXISTS ids_trust_receipt_events (
  id            TEXT PRIMARY KEY,
  receipt_id    TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  event_label   TEXT NOT NULL,
  actor_user_id TEXT,
  app_id        TEXT,
  tenant_id     TEXT,
  status        TEXT,
  metadata      TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES ids_trust_receipts(id)
);

CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_events_receipt_id
  ON ids_trust_receipt_events (receipt_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_events_event_type
  ON ids_trust_receipt_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_events_actor_user_id
  ON ids_trust_receipt_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_events_created_at
  ON ids_trust_receipt_events (created_at);

-- ── C. ids_trust_receipt_proof_links ──────────────────────────
-- References to proof/evidence items attached to a receipt.
-- Phase 7 hook layer only — SMS integration is Phase 8.
CREATE TABLE IF NOT EXISTS ids_trust_receipt_proof_links (
  id              TEXT PRIMARY KEY,
  receipt_id      TEXT NOT NULL,
  proof_type      TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'internal',
  external_ref_id TEXT,
  url             TEXT,
  label           TEXT,
  description     TEXT,
  content_hash    TEXT,
  status          TEXT NOT NULL DEFAULT 'attached',
  metadata        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (receipt_id) REFERENCES ids_trust_receipts(id)
);

CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_proof_links_receipt_id
  ON ids_trust_receipt_proof_links (receipt_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_proof_links_proof_type
  ON ids_trust_receipt_proof_links (proof_type);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_proof_links_provider
  ON ids_trust_receipt_proof_links (provider);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_proof_links_status
  ON ids_trust_receipt_proof_links (status);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_proof_links_created_at
  ON ids_trust_receipt_proof_links (created_at);

-- ── D. ids_trust_receipt_verifications ────────────────────────
-- Every public verification attempt against a receipt.
CREATE TABLE IF NOT EXISTS ids_trust_receipt_verifications (
  id                  TEXT PRIMARY KEY,
  receipt_id          TEXT,
  receipt_number      TEXT NOT NULL,
  verification_result TEXT NOT NULL,
  reason              TEXT,
  ip_address          TEXT,
  user_agent          TEXT,
  metadata            TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_verifications_receipt_id
  ON ids_trust_receipt_verifications (receipt_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_verifications_receipt_number
  ON ids_trust_receipt_verifications (receipt_number);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_verifications_verification_result
  ON ids_trust_receipt_verifications (verification_result);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_verifications_created_at
  ON ids_trust_receipt_verifications (created_at);

-- ── E. ids_trust_receipt_counters ─────────────────────────────
-- Simple counters for receipt number generation.
CREATE TABLE IF NOT EXISTS ids_trust_receipt_counters (
  counter_key   TEXT PRIMARY KEY,
  current_value INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

-- ── Service metadata update ───────────────────────────────────
UPDATE ids_service_metadata
SET value = 'phase_7_trustproof_engine', updated_at = datetime('now')
WHERE key = 'phase';
