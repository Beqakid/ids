/**
 * TrustProof Engine Types — Phase 7
 *
 * Full TrustProof receipt types.
 * The Phase 6 trustReceipts.ts envelope types remain unchanged for backward compat.
 *
 * Phase 7 expands the receipt type set and adds:
 *   - Finalized receipts (not just drafts)
 *   - Receipt timeline events
 *   - Proof links (SMS hook layer for Phase 8)
 *   - Public verification records
 *   - Receipt counters for number generation
 */

// ── Enum-style type unions ────────────────────────────────────

export type TrustReceiptType =
  | "kai_action"
  | "permission_check"
  | "verification"
  | "phone_verification"
  | "media_proof"
  | "admin_action"
  | "system_event"
  | "delivery_proof"
  | "care_event"
  | "vendor_event"
  | "knowledge_review";

export const TRUST_RECEIPT_TYPES: readonly TrustReceiptType[] = [
  "kai_action",
  "permission_check",
  "verification",
  "phone_verification",
  "media_proof",
  "admin_action",
  "system_event",
  "delivery_proof",
  "care_event",
  "vendor_event",
  "knowledge_review",
];

export type TrustReceiptActionType =
  | "explain"
  | "draft"
  | "prepare"
  | "dispatch"
  | "update"
  | "delete"
  | "verify"
  | "review"
  | "approve"
  | "reject"
  | "upload"
  | "complete"
  | "system";

export const TRUST_RECEIPT_ACTION_TYPES: readonly TrustReceiptActionType[] = [
  "explain",
  "draft",
  "prepare",
  "dispatch",
  "update",
  "delete",
  "verify",
  "review",
  "approve",
  "reject",
  "upload",
  "complete",
  "system",
];

export type TrustReceiptRiskLevel = "low" | "medium" | "high" | "blocked";

export const TRUST_RECEIPT_RISK_LEVELS: readonly TrustReceiptRiskLevel[] = [
  "low",
  "medium",
  "high",
  "blocked",
];

export type TrustReceiptStatus =
  | "draft"
  | "finalized"
  | "canceled"
  | "expired"
  | "voided";

export const TRUST_RECEIPT_STATUSES: readonly TrustReceiptStatus[] = [
  "draft",
  "finalized",
  "canceled",
  "expired",
  "voided",
];

export type TrustReceiptOutcome =
  | "allowed"
  | "denied"
  | "confirmed"
  | "completed"
  | "failed"
  | "canceled"
  | "pending"
  | "approved"
  | "rejected";

export const TRUST_RECEIPT_OUTCOMES: readonly TrustReceiptOutcome[] = [
  "allowed",
  "denied",
  "confirmed",
  "completed",
  "failed",
  "canceled",
  "pending",
  "approved",
  "rejected",
];

export type TrustReceiptVerificationStatus =
  | "valid"
  | "invalid"
  | "tampered"
  | "unavailable";

export const TRUST_RECEIPT_VERIFICATION_STATUSES: readonly TrustReceiptVerificationStatus[] =
  ["valid", "invalid", "tampered", "unavailable"];

export type TrustReceiptEventType =
  | "receipt_created"
  | "receipt_finalized"
  | "receipt_verified"
  | "receipt_canceled"
  | "receipt_voided"
  | "receipt_expired"
  | "action_prepared"
  | "action_confirmed"
  | "action_denied"
  | "action_completed"
  | "proof_link_added"
  | "proof_link_removed"
  | "verification_checked"
  | "metadata_updated"
  | "system_note_added";

export const TRUST_RECEIPT_EVENT_TYPES: readonly TrustReceiptEventType[] = [
  "receipt_created",
  "receipt_finalized",
  "receipt_verified",
  "receipt_canceled",
  "receipt_voided",
  "receipt_expired",
  "action_prepared",
  "action_confirmed",
  "action_denied",
  "action_completed",
  "proof_link_added",
  "proof_link_removed",
  "verification_checked",
  "metadata_updated",
  "system_note_added",
];

export type TrustProofLinkType =
  | "image"
  | "document"
  | "video"
  | "audio"
  | "signature"
  | "verification_event"
  | "media_asset"
  | "system_log"
  | "external_reference";

export const TRUST_PROOF_LINK_TYPES: readonly TrustProofLinkType[] = [
  "image",
  "document",
  "video",
  "audio",
  "signature",
  "verification_event",
  "media_asset",
  "system_log",
  "external_reference",
];

export type TrustProofProvider =
  | "internal"
  | "sms_future"
  | "r2_future"
  | "twilio"
  | "manual"
  | "external";

export const TRUST_PROOF_PROVIDERS: readonly TrustProofProvider[] = [
  "internal",
  "sms_future",
  "r2_future",
  "twilio",
  "manual",
  "external",
];

export type TrustProofLinkStatus =
  | "attached"
  | "removed"
  | "rejected"
  | "unavailable";

export const TRUST_PROOF_LINK_STATUSES: readonly TrustProofLinkStatus[] = [
  "attached",
  "removed",
  "rejected",
  "unavailable",
];

export type TrustReceiptVerificationResult =
  | "valid"
  | "invalid"
  | "not_found"
  | "tampered"
  | "expired"
  | "voided";

export const TRUST_RECEIPT_VERIFICATION_RESULTS: readonly TrustReceiptVerificationResult[] =
  ["valid", "invalid", "not_found", "tampered", "expired", "voided"];

// ── DB Row types ──────────────────────────────────────────────

export interface IdsTrustReceiptRow {
  id: string;
  receipt_number: string;
  receipt_type: string;
  source_app_id: string;
  source_tenant_id: string | null;
  user_id: string | null;
  actor_user_id: string | null;
  subject_user_id: string | null;
  action_context_id: string | null;
  envelope_id: string | null;
  action_key: string | null;
  action_label: string | null;
  action_type: string | null;
  risk_level: string;
  status: string;
  outcome: string | null;
  summary: string;
  public_summary: string | null;
  metadata: string | null;
  private_metadata: string | null;
  receipt_hash: string;
  previous_receipt_hash: string | null;
  content_hash: string | null;
  verification_status: string;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  expires_at: string | null;
}

export interface IdsTrustReceiptEventRow {
  id: string;
  receipt_id: string;
  event_type: string;
  event_label: string;
  actor_user_id: string | null;
  app_id: string | null;
  tenant_id: string | null;
  status: string | null;
  metadata: string | null;
  created_at: string;
}

export interface IdsTrustReceiptProofLinkRow {
  id: string;
  receipt_id: string;
  proof_type: string;
  provider: string;
  external_ref_id: string | null;
  url: string | null;
  label: string | null;
  description: string | null;
  content_hash: string | null;
  status: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdsTrustReceiptVerificationRow {
  id: string;
  receipt_id: string | null;
  receipt_number: string;
  verification_result: string;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

// ── Domain models ─────────────────────────────────────────────

export interface IdsTrustReceipt {
  id: string;
  receiptNumber: string;
  receiptType: TrustReceiptType;
  sourceAppId: string;
  sourceTenantId: string | null;
  userId: string | null;
  actorUserId: string | null;
  subjectUserId: string | null;
  actionContextId: string | null;
  envelopeId: string | null;
  actionKey: string | null;
  actionLabel: string | null;
  actionType: TrustReceiptActionType | null;
  riskLevel: TrustReceiptRiskLevel;
  status: TrustReceiptStatus;
  outcome: TrustReceiptOutcome | null;
  summary: string;
  publicSummary: string | null;
  metadata: Record<string, unknown> | null;
  // NOTE: privateMetadata is intentionally excluded from this domain model.
  // It must NEVER be returned in API responses.
  receiptHash: string;
  previousReceiptHash: string | null;
  contentHash: string | null;
  verificationStatus: TrustReceiptVerificationStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  expiresAt: string | null;
}

export interface IdsTrustReceiptEvent {
  id: string;
  receiptId: string;
  eventType: TrustReceiptEventType;
  eventLabel: string;
  actorUserId: string | null;
  appId: string | null;
  tenantId: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface IdsTrustReceiptProofLink {
  id: string;
  receiptId: string;
  proofType: TrustProofLinkType;
  provider: TrustProofProvider;
  externalRefId: string | null;
  url: string | null;
  label: string | null;
  description: string | null;
  contentHash: string | null;
  status: TrustProofLinkStatus;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ── Create input types ────────────────────────────────────────

export interface CreateTrustReceiptInput {
  receiptType: TrustReceiptType;
  sourceAppId: string;
  sourceTenantId?: string | null;
  userId?: string | null;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  actionContextId?: string | null;
  envelopeId?: string | null;
  actionKey?: string | null;
  actionLabel?: string | null;
  actionType?: TrustReceiptActionType | null;
  riskLevel?: TrustReceiptRiskLevel;
  outcome?: TrustReceiptOutcome | null;
  summary: string;
  publicSummary?: string | null;
  metadata?: Record<string, unknown> | null;
  privateMetadata?: Record<string, unknown> | null;
}

export interface FinalizeTrustReceiptInput {
  outcome?: TrustReceiptOutcome | null;
  summary?: string | null;
  publicSummary?: string | null;
}

export interface AddTrustReceiptEventInput {
  receiptId: string;
  eventType: TrustReceiptEventType;
  eventLabel: string;
  actorUserId?: string | null;
  appId?: string | null;
  tenantId?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AddProofLinkInput {
  receiptId: string;
  proofType: TrustProofLinkType;
  provider?: TrustProofProvider;
  externalRefId?: string | null;
  url?: string | null;
  label?: string | null;
  description?: string | null;
  contentHash?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WriteReceiptVerificationInput {
  receiptId?: string | null;
  receiptNumber: string;
  verificationResult: TrustReceiptVerificationResult;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListTrustReceiptsOptions {
  limit: number;
  offset: number;
  receiptType?: string;
  sourceAppId?: string;
  sourceTenantId?: string;
  userId?: string;
  actorUserId?: string;
  subjectUserId?: string;
  actionContextId?: string;
  status?: string;
  outcome?: string;
  riskLevel?: string;
}

// ── Public verification response ──────────────────────────────

export interface TrustProofPublicVerificationResponse {
  receiptNumber: string;
  verificationResult: TrustReceiptVerificationResult;
  receiptType: TrustReceiptType;
  sourceAppId: string;
  riskLevel: TrustReceiptRiskLevel;
  status: TrustReceiptStatus;
  outcome: TrustReceiptOutcome | null;
  publicSummary: string | null;
  createdAt: string;
  finalizedAt: string | null;
  fingerprint: string;
}
