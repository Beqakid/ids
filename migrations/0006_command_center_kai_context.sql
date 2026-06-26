-- Phase 6: Command Center + Kai Integration Prep
-- Creates context request logs, Kai action context records, and TrustProof receipt envelope structure.

-- ── A. ids_platform_context_requests ────────────────────────
CREATE TABLE IF NOT EXISTS ids_platform_context_requests (
  id                   TEXT PRIMARY KEY,
  requester_type       TEXT NOT NULL,
  requester_client_id  TEXT,
  requester_app_id     TEXT,
  user_id              TEXT,
  target_app_id        TEXT,
  target_tenant_id     TEXT,
  context_type         TEXT NOT NULL,
  success              INTEGER NOT NULL DEFAULT 0,
  reason               TEXT,
  ip_address           TEXT,
  user_agent           TEXT,
  metadata             TEXT,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_user_id
  ON ids_platform_context_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_requester_type
  ON ids_platform_context_requests (requester_type);
CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_requester_client_id
  ON ids_platform_context_requests (requester_client_id);
CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_target_app_id
  ON ids_platform_context_requests (target_app_id);
CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_context_type
  ON ids_platform_context_requests (context_type);
CREATE INDEX IF NOT EXISTS idx_ids_platform_context_requests_created_at
  ON ids_platform_context_requests (created_at);

-- ── B. ids_kai_action_contexts ───────────────────────────────
CREATE TABLE IF NOT EXISTS ids_kai_action_contexts (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  app_id                  TEXT NOT NULL,
  tenant_id               TEXT,
  action_key              TEXT NOT NULL,
  action_label            TEXT NOT NULL,
  action_type             TEXT NOT NULL,
  risk_level              TEXT NOT NULL DEFAULT 'low',
  status                  TEXT NOT NULL DEFAULT 'prepared',
  requires_confirmation   INTEGER NOT NULL DEFAULT 0,
  requires_admin_approval INTEGER NOT NULL DEFAULT 0,
  allowed                 INTEGER NOT NULL DEFAULT 0,
  denied_reason           TEXT,
  permission_key          TEXT,
  matched_roles           TEXT,
  matched_permissions     TEXT,
  trust_signals           TEXT,
  metadata                TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  expires_at              TEXT
);

CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_user_id
  ON ids_kai_action_contexts (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_app_id
  ON ids_kai_action_contexts (app_id);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_tenant_id
  ON ids_kai_action_contexts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_action_key
  ON ids_kai_action_contexts (action_key);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_risk_level
  ON ids_kai_action_contexts (risk_level);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_status
  ON ids_kai_action_contexts (status);
CREATE INDEX IF NOT EXISTS idx_ids_kai_action_contexts_created_at
  ON ids_kai_action_contexts (created_at);

-- ── C. ids_trust_receipt_envelopes ───────────────────────────
CREATE TABLE IF NOT EXISTS ids_trust_receipt_envelopes (
  id                TEXT PRIMARY KEY,
  receipt_type      TEXT NOT NULL,
  source_app_id     TEXT NOT NULL,
  source_tenant_id  TEXT,
  user_id           TEXT,
  action_context_id TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  risk_level        TEXT,
  action_key        TEXT,
  summary           TEXT,
  proof_links       TEXT,
  metadata          TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  finalized_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_receipt_type
  ON ids_trust_receipt_envelopes (receipt_type);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_source_app_id
  ON ids_trust_receipt_envelopes (source_app_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_source_tenant_id
  ON ids_trust_receipt_envelopes (source_tenant_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_user_id
  ON ids_trust_receipt_envelopes (user_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_action_context_id
  ON ids_trust_receipt_envelopes (action_context_id);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_status
  ON ids_trust_receipt_envelopes (status);
CREATE INDEX IF NOT EXISTS idx_ids_trust_receipt_envelopes_created_at
  ON ids_trust_receipt_envelopes (created_at);

-- ── Service metadata update ──────────────────────────────────
UPDATE ids_service_metadata
SET value = 'phase_6_command_center_kai_integration_prep', updated_at = datetime('now')
WHERE key = 'phase';
