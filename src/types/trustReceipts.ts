/**
 * Trust Receipt Envelope Types — Phase 6
 *
 * This is NOT the full TrustProof engine.
 * Phase 6 only creates the draft receipt envelope structure.
 * TODO: Phase 7 — Full TrustProof Engine: final receipts, receipt verification,
 *       receipt timeline, and SMS proof asset hooks.
 */

export type TrustReceiptType =
  | "kai_action"
  | "permission_check"
  | "verification"
  | "media_proof"
  | "admin_action"
  | "system_event";

export type TrustReceiptEnvelopeStatus =
  | "draft"
  | "finalized"
  | "canceled"
  | "expired";

// ── DB row ────────────────────────────────────────────────────

export interface IdsTrustReceiptEnvelopeRow {
  id: string;
  receipt_type: string;
  source_app_id: string;
  source_tenant_id: string | null;
  user_id: string | null;
  action_context_id: string | null;
  status: string;
  risk_level: string | null;
  action_key: string | null;
  summary: string | null;
  proof_links: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
}

// ── Domain model ──────────────────────────────────────────────

export interface IdsTrustReceiptEnvelope {
  id: string;
  receiptType: TrustReceiptType;
  sourceAppId: string;
  sourceTenantId: string | null;
  userId: string | null;
  actionContextId: string | null;
  status: TrustReceiptEnvelopeStatus;
  riskLevel: string | null;
  actionKey: string | null;
  summary: string | null;
  proofLinks: string[] | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
}

// ── Create input ──────────────────────────────────────────────

export interface CreateTrustReceiptEnvelopeInput {
  receiptType: TrustReceiptType;
  sourceAppId: string;
  sourceTenantId?: string | null;
  userId?: string | null;
  actionContextId?: string | null;
  riskLevel?: string | null;
  actionKey?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Finalize input ────────────────────────────────────────────

export interface FinalizeTrustReceiptEnvelopeInput {
  summary?: string | null;
  proofLinks?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

// ── List options ──────────────────────────────────────────────

export interface ListTrustReceiptEnvelopesOptions {
  limit: number;
  offset: number;
  userId?: string;
  sourceAppId?: string;
  sourceTenantId?: string;
  receiptType?: string;
  status?: string;
}
