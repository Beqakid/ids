/**
 * TrustProof Service — Phase 7
 *
 * Core engine for creating, managing, and verifying TrustProof receipts.
 *
 * Security rules:
 * - private_metadata is NEVER returned in any response.
 * - Receipt hashes are recomputed on verification to detect tampering.
 * - Every verification attempt is logged regardless of outcome.
 * - Canceled receipts use voided instead of hard delete (data is preserved).
 *
 * Out of scope (Phase 8+):
 * - SMS media asset linking
 * - Customer-facing receipt UI
 * - Blockchain / external anchoring
 */

import type { Env } from "../types/env";
import type {
  IdsTrustReceipt,
  IdsTrustReceiptRow,
  IdsTrustReceiptEvent,
  IdsTrustReceiptEventRow,
  IdsTrustReceiptProofLink,
  IdsTrustReceiptProofLinkRow,
  WriteReceiptVerificationInput,
  CreateTrustReceiptInput,
  FinalizeTrustReceiptInput,
  AddTrustReceiptEventInput,
  AddProofLinkInput,
  ListTrustReceiptsOptions,
  TrustReceiptStatus,
  TrustReceiptType,
  TrustReceiptActionType,
  TrustReceiptRiskLevel,
  TrustReceiptOutcome,
  TrustReceiptVerificationStatus,
  TrustReceiptEventType,
  TrustProofLinkType,
  TrustProofProvider,
  TrustProofLinkStatus,
  TrustReceiptVerificationResult,
  TrustProofPublicVerificationResponse,
} from "../types/trustProof";
import { getDB } from "../lib/db";
import { hashReceiptPayload, verifyReceiptHash, buildReceiptPublicFingerprint } from "../lib/trustProofHash";
import { generateReceiptNumber } from "../lib/receiptNumbers";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getAppByIdSilent } from "./apps";
import { getUserById } from "./users";
import { getTenantByIdSilent } from "./tenants";

// ── Row → Domain model helpers ────────────────────────────────

function parseJsonObj(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToReceipt(row: IdsTrustReceiptRow): IdsTrustReceipt {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    receiptType: row.receipt_type as TrustReceiptType,
    sourceAppId: row.source_app_id,
    sourceTenantId: row.source_tenant_id,
    userId: row.user_id,
    actorUserId: row.actor_user_id,
    subjectUserId: row.subject_user_id,
    actionContextId: row.action_context_id,
    envelopeId: row.envelope_id,
    actionKey: row.action_key,
    actionLabel: row.action_label,
    actionType: (row.action_type as TrustReceiptActionType) ?? null,
    riskLevel: row.risk_level as TrustReceiptRiskLevel,
    status: row.status as TrustReceiptStatus,
    outcome: (row.outcome as TrustReceiptOutcome) ?? null,
    summary: row.summary,
    publicSummary: row.public_summary,
    metadata: parseJsonObj(row.metadata),
    // private_metadata intentionally excluded from domain model
    receiptHash: row.receipt_hash,
    previousReceiptHash: row.previous_receipt_hash,
    contentHash: row.content_hash,
    verificationStatus: row.verification_status as TrustReceiptVerificationStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
    expiresAt: row.expires_at,
  };
}

function rowToEvent(row: IdsTrustReceiptEventRow): IdsTrustReceiptEvent {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    eventType: row.event_type as TrustReceiptEventType,
    eventLabel: row.event_label,
    actorUserId: row.actor_user_id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    status: row.status,
    metadata: parseJsonObj(row.metadata),
    createdAt: row.created_at,
  };
}

function rowToProofLink(row: IdsTrustReceiptProofLinkRow): IdsTrustReceiptProofLink {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    proofType: row.proof_type as TrustProofLinkType,
    provider: row.provider as TrustProofProvider,
    externalRefId: row.external_ref_id,
    url: row.url,
    label: row.label,
    description: row.description,
    contentHash: row.content_hash,
    status: row.status as TrustProofLinkStatus,
    metadata: parseJsonObj(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Request context type ──────────────────────────────────────

export interface TrustProofRequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  clientId?: string | null;
}

// ── Get helpers ───────────────────────────────────────────────

export async function getTrustReceiptById(
  env: Env,
  id: string
): Promise<IdsTrustReceipt | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_trust_receipts WHERE id = ?")
    .bind(id)
    .first<IdsTrustReceiptRow>();
  return row ? rowToReceipt(row) : null;
}

export async function getTrustReceiptByNumber(
  env: Env,
  receiptNumber: string
): Promise<IdsTrustReceipt | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_trust_receipts WHERE receipt_number = ?")
    .bind(receiptNumber.trim().toUpperCase())
    .first<IdsTrustReceiptRow>();
  return row ? rowToReceipt(row) : null;
}

// ── List receipts ─────────────────────────────────────────────

export async function listTrustReceipts(
  env: Env,
  opts: ListTrustReceiptsOptions
): Promise<{ receipts: IdsTrustReceipt[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.receiptType) { conditions.push("receipt_type = ?"); params.push(opts.receiptType); }
  if (opts.sourceAppId) { conditions.push("source_app_id = ?"); params.push(opts.sourceAppId); }
  if (opts.sourceTenantId) { conditions.push("source_tenant_id = ?"); params.push(opts.sourceTenantId); }
  if (opts.userId) { conditions.push("user_id = ?"); params.push(opts.userId); }
  if (opts.actorUserId) { conditions.push("actor_user_id = ?"); params.push(opts.actorUserId); }
  if (opts.subjectUserId) { conditions.push("subject_user_id = ?"); params.push(opts.subjectUserId); }
  if (opts.actionContextId) { conditions.push("action_context_id = ?"); params.push(opts.actionContextId); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.outcome) { conditions.push("outcome = ?"); params.push(opts.outcome); }
  if (opts.riskLevel) { conditions.push("risk_level = ?"); params.push(opts.riskLevel); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_trust_receipts ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_trust_receipts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsTrustReceiptRow>();

  return {
    receipts: (rows.results ?? []).map(rowToReceipt),
    total,
  };
}

// ── Create receipt ────────────────────────────────────────────

export async function createTrustReceipt(
  input: CreateTrustReceiptInput,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);

  // 1. Validate source_app_id
  const app = await getAppByIdSilent(env, input.sourceAppId);
  if (!app) {
    throw new TrustProofValidationError("source_app_id not found.");
  }

  // 2. Validate source_tenant_id if provided
  if (input.sourceTenantId) {
    const tenant = await getTenantByIdSilent(env, input.sourceTenantId);
    if (!tenant) throw new TrustProofValidationError("sourceTenantId not found.");
  }

  // 3. Validate user_id if provided
  if (input.userId) {
    const user = await getUserById(env, input.userId);
    if (!user) throw new TrustProofValidationError("userId not found.");
  }

  // 4. Validate actor_user_id if provided
  if (input.actorUserId) {
    const actor = await getUserById(env, input.actorUserId);
    if (!actor) throw new TrustProofValidationError("actorUserId not found.");
  }

  // 5. Validate subject_user_id if provided
  if (input.subjectUserId) {
    const subject = await getUserById(env, input.subjectUserId);
    if (!subject) throw new TrustProofValidationError("subjectUserId not found.");
  }

  // 6. Validate action_context_id if provided
  if (input.actionContextId) {
    const ctx = await db
      .prepare("SELECT id FROM ids_kai_action_contexts WHERE id = ?")
      .bind(input.actionContextId)
      .first<{ id: string }>();
    if (!ctx) throw new TrustProofValidationError("actionContextId not found.");
  }

  // 7. Validate envelope_id if provided
  if (input.envelopeId) {
    const env2 = await db
      .prepare("SELECT id FROM ids_trust_receipt_envelopes WHERE id = ?")
      .bind(input.envelopeId)
      .first<{ id: string }>();
    if (!env2) throw new TrustProofValidationError("envelopeId not found.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const riskLevel: TrustReceiptRiskLevel = input.riskLevel ?? "low";

  // 8. Generate receipt number
  const receiptNumber = await generateReceiptNumber(db, input.receiptType, input.sourceAppId);

  // 9. Compute receipt hash (no finalized_at yet)
  const receiptHash = await hashReceiptPayload({
    receiptNumber,
    receiptType: input.receiptType,
    sourceAppId: input.sourceAppId,
    sourceTenantId: input.sourceTenantId ?? null,
    userId: input.userId ?? null,
    actorUserId: input.actorUserId ?? null,
    subjectUserId: input.subjectUserId ?? null,
    actionKey: input.actionKey ?? null,
    actionType: (input.actionType ?? null) as TrustReceiptActionType | null,
    riskLevel,
    outcome: input.outcome ?? null,
    summary: input.summary,
    createdAt: now,
    finalizedAt: null,
  });

  // 10. Insert receipt
  await db
    .prepare(
      `INSERT INTO ids_trust_receipts
         (id, receipt_number, receipt_type, source_app_id, source_tenant_id,
          user_id, actor_user_id, subject_user_id, action_context_id, envelope_id,
          action_key, action_label, action_type, risk_level, status, outcome,
          summary, public_summary, metadata, private_metadata, receipt_hash,
          previous_receipt_hash, content_hash, verification_status,
          created_at, updated_at, finalized_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, NULL, NULL, 'valid', ?, ?, NULL, ?)`
    )
    .bind(
      id,
      receiptNumber,
      input.receiptType,
      input.sourceAppId,
      input.sourceTenantId ?? null,
      input.userId ?? null,
      input.actorUserId ?? null,
      input.subjectUserId ?? null,
      input.actionContextId ?? null,
      input.envelopeId ?? null,
      input.actionKey ?? null,
      input.actionLabel ?? null,
      input.actionType ?? null,
      riskLevel,
      input.outcome ?? null,
      input.summary,
      input.publicSummary ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.privateMetadata ? JSON.stringify(input.privateMetadata) : null,
      receiptHash,
      now,
      now,
      null // expires_at — set by caller if needed
    )
    .run();

  // 11. Add receipt_created timeline event
  await addTrustReceiptEvent({
    receiptId: id,
    eventType: "receipt_created",
    eventLabel: "Receipt created",
    actorUserId: input.actorUserId ?? input.userId ?? null,
    appId: input.sourceAppId,
    tenantId: input.sourceTenantId ?? null,
    metadata: { receiptType: input.receiptType, riskLevel },
  }, env);

  // 12. Write audit log
  await writeAuditLog(env, {
    eventType: "trust_receipt_created",
    userId: input.userId,
    appId: input.sourceAppId,
    tenantId: input.sourceTenantId,
    actorUserId: input.actorUserId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: {
      receiptId: id,
      receiptNumber,
      receiptType: input.receiptType,
      sourceAppId: input.sourceAppId,
      sourceTenantId: input.sourceTenantId ?? null,
      userId: input.userId ?? null,
      actionContextId: input.actionContextId ?? null,
      envelopeId: input.envelopeId ?? null,
      riskLevel,
      status: "draft",
      outcome: input.outcome ?? null,
    },
  });

  // 13. Write app access log
  try {
    await writeAppAccessLog(env, {
      appId: input.sourceAppId,
      userId: input.userId,
      tenantId: input.sourceTenantId,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "trust_receipt_created", receiptId: id, receiptNumber },
    });
  } catch {
    // Non-fatal
  }

  const created = await getTrustReceiptById(env, id);
  return created!;
}

// ── Create from Phase 6 envelope ─────────────────────────────

export async function createTrustReceiptFromEnvelope(
  envelopeId: string,
  input: Omit<CreateTrustReceiptInput, "sourceAppId" | "sourceTenantId" | "userId" | "actionContextId" | "envelopeId" | "riskLevel" | "actionKey">,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);

  // Load the Phase 6 envelope
  const envelopeRow = await db
    .prepare("SELECT * FROM ids_trust_receipt_envelopes WHERE id = ?")
    .bind(envelopeId)
    .first<{
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
      metadata: string | null;
    }>();

  if (!envelopeRow) {
    throw new TrustProofNotFoundError("Trust receipt envelope not found.");
  }

  if (envelopeRow.status === "canceled") {
    throw new TrustProofValidationError("Cannot create receipt from a canceled envelope.");
  }

  const envelopeMeta = envelopeRow.metadata
    ? (() => { try { return JSON.parse(envelopeRow.metadata); } catch { return null; } })()
    : null;

  // Map envelope fields to receipt input
  const receiptInput: CreateTrustReceiptInput = {
    receiptType: envelopeRow.receipt_type as TrustReceiptType,
    sourceAppId: envelopeRow.source_app_id,
    sourceTenantId: envelopeRow.source_tenant_id,
    userId: envelopeRow.user_id,
    actionContextId: envelopeRow.action_context_id ?? undefined,
    envelopeId,
    actionKey: envelopeRow.action_key ?? undefined,
    riskLevel: (envelopeRow.risk_level as TrustReceiptRiskLevel) ?? "low",
    summary: envelopeRow.summary ?? input.summary ?? "Receipt created from envelope.",
    publicSummary: input.publicSummary ?? null,
    metadata: {
      ...(envelopeMeta ?? {}),
      ...(input.metadata ?? {}),
      source: "envelope",
      envelopeId,
      envelopeStatus: envelopeRow.status,
    },
    privateMetadata: input.privateMetadata ?? null,
    ...input,
  };

  const receipt = await createTrustReceipt(receiptInput, env, requestContext);

  // TODO (Phase 7+): Mark envelope as linked when allowed statuses support it.
  // For now, we add metadata to signal the link was created.
  // Backward compat: we do not change the envelope status (only draft/finalized/canceled/expired are valid).
  // A future migration can add a 'linked' status if needed.

  // Write specialized audit event
  await writeAuditLog(env, {
    eventType: "trust_receipt_created_from_envelope",
    userId: envelopeRow.user_id,
    appId: envelopeRow.source_app_id,
    tenantId: envelopeRow.source_tenant_id,
    metadata: {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      envelopeId,
      envelopeStatus: envelopeRow.status,
    },
  });

  return receipt;
}

// ── Create from Kai action context ────────────────────────────

export async function createTrustReceiptFromKaiActionContext(
  actionContextId: string,
  input: Partial<Omit<CreateTrustReceiptInput, "actionContextId" | "sourceAppId" | "userId" | "riskLevel">>,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);

  // Load the Kai action context
  const contextRow = await db
    .prepare("SELECT * FROM ids_kai_action_contexts WHERE id = ?")
    .bind(actionContextId)
    .first<{
      id: string;
      user_id: string;
      app_id: string;
      tenant_id: string | null;
      action_key: string;
      action_label: string;
      action_type: string;
      risk_level: string;
      status: string;
      allowed: number;
      denied_reason: string | null;
      metadata: string | null;
    }>();

  if (!contextRow) {
    throw new TrustProofNotFoundError("Kai action context not found.");
  }

  const contextMeta = contextRow.metadata
    ? (() => { try { return JSON.parse(contextRow.metadata); } catch { return null; } })()
    : null;

  const receiptInput: CreateTrustReceiptInput = {
    receiptType: "kai_action",
    sourceAppId: contextRow.app_id,
    sourceTenantId: contextRow.tenant_id,
    userId: contextRow.user_id,
    actorUserId: contextRow.user_id,
    actionContextId,
    actionKey: contextRow.action_key,
    actionLabel: contextRow.action_label,
    actionType: contextRow.action_type as TrustReceiptActionType,
    riskLevel: contextRow.risk_level as TrustReceiptRiskLevel,
    outcome: contextRow.allowed ? "allowed" : "denied",
    summary: input.summary ?? `Kai prepared a ${contextRow.risk_level}-risk ${contextRow.action_type} action: ${contextRow.action_label}`,
    publicSummary: input.publicSummary ?? `A ${contextRow.risk_level}-risk Kai action was prepared.`,
    metadata: {
      ...(contextMeta ?? {}),
      ...(input.metadata ?? {}),
      source: "kai_action_context",
      kaiActionContextId: actionContextId,
      kaiStatus: contextRow.status,
      allowed: contextRow.allowed === 1,
      deniedReason: contextRow.denied_reason ?? null,
    },
    privateMetadata: input.privateMetadata ?? null,
    ...input,
  };

  const receipt = await createTrustReceipt(receiptInput, env, requestContext);

  // Add action_prepared event
  await addTrustReceiptEvent({
    receiptId: receipt.id,
    eventType: "action_prepared",
    eventLabel: `Kai action prepared: ${contextRow.action_label}`,
    actorUserId: contextRow.user_id,
    appId: contextRow.app_id,
    tenantId: contextRow.tenant_id,
    metadata: {
      actionKey: contextRow.action_key,
      actionType: contextRow.action_type,
      riskLevel: contextRow.risk_level,
      kaiStatus: contextRow.status,
    },
  }, env);

  // Write specialized audit event
  await writeAuditLog(env, {
    eventType: "trust_receipt_created_from_kai_action",
    userId: contextRow.user_id,
    appId: contextRow.app_id,
    tenantId: contextRow.tenant_id,
    metadata: {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      actionContextId,
      actionKey: contextRow.action_key,
      riskLevel: contextRow.risk_level,
    },
  });

  return receipt;
}

// ── Finalize receipt ──────────────────────────────────────────

export async function finalizeTrustReceipt(
  receiptId: string,
  input: FinalizeTrustReceiptInput,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);

  const existing = await getTrustReceiptById(env, receiptId);
  if (!existing) throw new TrustProofNotFoundError("Receipt not found.");
  if (existing.status !== "draft") {
    throw new TrustProofValidationError(
      `Only draft receipts can be finalized. Current status: ${existing.status}`
    );
  }

  const now = new Date().toISOString();
  const newSummary = input.summary ?? existing.summary;
  const newOutcome = input.outcome ?? existing.outcome;
  const newPublicSummary = input.publicSummary ?? existing.publicSummary;

  // Recompute hash with finalized_at included
  const newHash = await hashReceiptPayload({
    ...existing,
    summary: newSummary,
    outcome: newOutcome,
    finalizedAt: now,
  });

  await db
    .prepare(
      `UPDATE ids_trust_receipts
       SET status = 'finalized',
           finalized_at = ?,
           updated_at = ?,
           receipt_hash = ?,
           summary = ?,
           outcome = ?,
           public_summary = COALESCE(?, public_summary)
       WHERE id = ?`
    )
    .bind(now, now, newHash, newSummary, newOutcome ?? null, newPublicSummary ?? null, receiptId)
    .run();

  await addTrustReceiptEvent({
    receiptId,
    eventType: "receipt_finalized",
    eventLabel: "Receipt finalized",
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    metadata: { outcome: newOutcome, finalizedAt: now },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_finalized",
    userId: existing.userId,
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: {
      receiptId,
      receiptNumber: existing.receiptNumber,
      receiptType: existing.receiptType,
      riskLevel: existing.riskLevel,
      status: "finalized",
      outcome: newOutcome ?? null,
    },
  });

  try {
    await writeAppAccessLog(env, {
      appId: existing.sourceAppId,
      userId: existing.userId,
      tenantId: existing.sourceTenantId,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "trust_receipt_finalized", receiptId, receiptNumber: existing.receiptNumber },
    });
  } catch {
    // Non-fatal
  }

  return (await getTrustReceiptById(env, receiptId))!;
}

// ── Cancel receipt ────────────────────────────────────────────

export async function cancelTrustReceipt(
  receiptId: string,
  reason: string | null,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);
  const existing = await getTrustReceiptById(env, receiptId);
  if (!existing) throw new TrustProofNotFoundError("Receipt not found.");

  if (existing.status === "finalized") {
    throw new TrustProofValidationError(
      "Finalized receipts cannot be canceled. Use void instead."
    );
  }
  if (["canceled", "voided", "expired"].includes(existing.status)) {
    throw new TrustProofValidationError(`Receipt is already ${existing.status}.`);
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE ids_trust_receipts SET status = 'canceled', updated_at = ? WHERE id = ?`
    )
    .bind(now, receiptId)
    .run();

  await addTrustReceiptEvent({
    receiptId,
    eventType: "receipt_canceled",
    eventLabel: reason ? `Receipt canceled: ${reason}` : "Receipt canceled",
    appId: existing.sourceAppId,
    metadata: { reason },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_canceled",
    userId: existing.userId,
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: { receiptId, receiptNumber: existing.receiptNumber, reason },
  });

  return (await getTrustReceiptById(env, receiptId))!;
}

// ── Void receipt ──────────────────────────────────────────────

export async function voidTrustReceipt(
  receiptId: string,
  reason: string | null,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceipt> {
  const db = getDB(env);
  const existing = await getTrustReceiptById(env, receiptId);
  if (!existing) throw new TrustProofNotFoundError("Receipt not found.");

  if (existing.status !== "finalized") {
    throw new TrustProofValidationError(
      "Only finalized receipts can be voided. Draft receipts should be canceled."
    );
  }

  const now = new Date().toISOString();
  // Preserve original receipt_hash — voided receipts keep their hash for audit trail
  await db
    .prepare(
      `UPDATE ids_trust_receipts SET status = 'voided', verification_status = 'unavailable', updated_at = ? WHERE id = ?`
    )
    .bind(now, receiptId)
    .run();

  await addTrustReceiptEvent({
    receiptId,
    eventType: "receipt_voided",
    eventLabel: reason ? `Receipt voided: ${reason}` : "Receipt voided",
    appId: existing.sourceAppId,
    metadata: { reason },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_voided",
    userId: existing.userId,
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: { receiptId, receiptNumber: existing.receiptNumber, reason },
  });

  return (await getTrustReceiptById(env, receiptId))!;
}

// ── Timeline events ───────────────────────────────────────────

export async function addTrustReceiptEvent(
  input: AddTrustReceiptEventInput,
  env: Env
): Promise<IdsTrustReceiptEvent> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_trust_receipt_events
         (id, receipt_id, event_type, event_label, actor_user_id, app_id, tenant_id, status, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.receiptId,
      input.eventType,
      input.eventLabel,
      input.actorUserId ?? null,
      input.appId ?? null,
      input.tenantId ?? null,
      input.status ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    )
    .run();

  return {
    id,
    receiptId: input.receiptId,
    eventType: input.eventType,
    eventLabel: input.eventLabel,
    actorUserId: input.actorUserId ?? null,
    appId: input.appId ?? null,
    tenantId: input.tenantId ?? null,
    status: input.status ?? null,
    metadata: input.metadata ?? null,
    createdAt: now,
  };
}

export async function listTrustReceiptEvents(
  env: Env,
  receiptId: string
): Promise<IdsTrustReceiptEvent[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      `SELECT * FROM ids_trust_receipt_events WHERE receipt_id = ? ORDER BY created_at ASC`
    )
    .bind(receiptId)
    .all<IdsTrustReceiptEventRow>();
  return (rows.results ?? []).map(rowToEvent);
}

// ── Proof links ───────────────────────────────────────────────

export async function addProofLinkToReceipt(
  input: AddProofLinkInput,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceiptProofLink> {
  const db = getDB(env);

  const receipt = await getTrustReceiptById(env, input.receiptId);
  if (!receipt) throw new TrustProofNotFoundError("Receipt not found.");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_trust_receipt_proof_links
         (id, receipt_id, proof_type, provider, external_ref_id, url, label, description, content_hash, status, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'attached', ?, ?, ?)`
    )
    .bind(
      id,
      input.receiptId,
      input.proofType,
      input.provider ?? "internal",
      input.externalRefId ?? null,
      input.url ?? null,
      input.label ?? null,
      input.description ?? null,
      input.contentHash ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now
    )
    .run();

  await addTrustReceiptEvent({
    receiptId: input.receiptId,
    eventType: "proof_link_added",
    eventLabel: input.label ? `Proof link added: ${input.label}` : "Proof link added",
    appId: receipt.sourceAppId,
    metadata: { proofLinkId: id, proofType: input.proofType, provider: input.provider ?? "internal" },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_proof_link_added",
    appId: receipt.sourceAppId,
    tenantId: receipt.sourceTenantId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: {
      receiptId: input.receiptId,
      receiptNumber: receipt.receiptNumber,
      proofLinkId: id,
      proofType: input.proofType,
      provider: input.provider ?? "internal",
    },
  });

  try {
    await writeAppAccessLog(env, {
      appId: receipt.sourceAppId,
      userId: receipt.userId,
      tenantId: receipt.sourceTenantId,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "trust_receipt_proof_link_added", receiptId: input.receiptId, proofLinkId: id },
    });
  } catch {
    // Non-fatal
  }

  const row = await db
    .prepare("SELECT * FROM ids_trust_receipt_proof_links WHERE id = ?")
    .bind(id)
    .first<IdsTrustReceiptProofLinkRow>();
  return rowToProofLink(row!);
}

export async function removeProofLinkFromReceipt(
  proofLinkId: string,
  reason: string | null,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<IdsTrustReceiptProofLink> {
  const db = getDB(env);

  const row = await db
    .prepare("SELECT * FROM ids_trust_receipt_proof_links WHERE id = ?")
    .bind(proofLinkId)
    .first<IdsTrustReceiptProofLinkRow>();
  if (!row) throw new TrustProofNotFoundError("Proof link not found.");

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE ids_trust_receipt_proof_links SET status = 'removed', updated_at = ? WHERE id = ?`
    )
    .bind(now, proofLinkId)
    .run();

  const receipt = await getTrustReceiptById(env, row.receipt_id);

  await addTrustReceiptEvent({
    receiptId: row.receipt_id,
    eventType: "proof_link_removed",
    eventLabel: reason ? `Proof link removed: ${reason}` : "Proof link removed",
    appId: receipt?.sourceAppId ?? null,
    metadata: { proofLinkId, reason },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_proof_link_removed",
    appId: receipt?.sourceAppId,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: { proofLinkId, receiptId: row.receipt_id, reason },
  });

  try {
    await writeAppAccessLog(env, {
      appId: receipt?.sourceAppId ?? "unknown",
      userId: receipt?.userId,
      tenantId: receipt?.sourceTenantId,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "trust_receipt_proof_link_removed", proofLinkId },
    });
  } catch {
    // Non-fatal
  }

  const updated = await db
    .prepare("SELECT * FROM ids_trust_receipt_proof_links WHERE id = ?")
    .bind(proofLinkId)
    .first<IdsTrustReceiptProofLinkRow>();
  return rowToProofLink(updated!);
}

export async function listProofLinksForReceipt(
  env: Env,
  receiptId: string
): Promise<IdsTrustReceiptProofLink[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      `SELECT * FROM ids_trust_receipt_proof_links WHERE receipt_id = ? ORDER BY created_at ASC`
    )
    .bind(receiptId)
    .all<IdsTrustReceiptProofLinkRow>();
  return (rows.results ?? []).map(rowToProofLink);
}

// ── Public verification ───────────────────────────────────────

export async function verifyTrustReceipt(
  receiptNumber: string,
  env: Env,
  requestContext?: TrustProofRequestContext
): Promise<TrustProofPublicVerificationResponse> {
  const normalizedNumber = receiptNumber.trim().toUpperCase();

  // Look up receipt
  const receipt = await getTrustReceiptByNumber(env, normalizedNumber);

  if (!receipt) {
    await writeReceiptVerification({
      receiptId: null,
      receiptNumber: normalizedNumber,
      verificationResult: "not_found",
      reason: "Receipt not found",
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    }, env);

    await writeAuditLog(env, {
      eventType: "trust_receipt_verification_failed",
      metadata: { receiptNumber: normalizedNumber, reason: "not_found" },
    });

    return buildPublicNotFoundResponse(normalizedNumber);
  }

  // Check voided
  if (receipt.status === "voided") {
    await writeReceiptVerification({
      receiptId: receipt.id,
      receiptNumber: normalizedNumber,
      verificationResult: "voided",
      reason: "Receipt has been voided",
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    }, env);

    await addTrustReceiptEvent({
      receiptId: receipt.id,
      eventType: "verification_checked",
      eventLabel: "Verification attempted — receipt voided",
      metadata: { result: "voided" },
    }, env);

    return buildPublicResponse(receipt, "voided");
  }

  // Check expired
  if (receipt.status === "expired" || (receipt.expiresAt && receipt.expiresAt < new Date().toISOString())) {
    await writeReceiptVerification({
      receiptId: receipt.id,
      receiptNumber: normalizedNumber,
      verificationResult: "expired",
      reason: "Receipt has expired",
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    }, env);

    await addTrustReceiptEvent({
      receiptId: receipt.id,
      eventType: "verification_checked",
      eventLabel: "Verification attempted — receipt expired",
      metadata: { result: "expired" },
    }, env);

    return buildPublicResponse(receipt, "expired");
  }

  // Verify hash integrity
  const hashValid = await verifyReceiptHash(receipt);

  if (!hashValid) {
    // Mark receipt as tampered
    const db = getDB(env);
    await db
      .prepare(
        `UPDATE ids_trust_receipts SET verification_status = 'tampered', updated_at = ? WHERE id = ?`
      )
      .bind(new Date().toISOString(), receipt.id)
      .run();

    await writeReceiptVerification({
      receiptId: receipt.id,
      receiptNumber: normalizedNumber,
      verificationResult: "tampered",
      reason: "Hash mismatch — receipt may have been modified",
      ipAddress: requestContext?.ipAddress,
      userAgent: requestContext?.userAgent,
    }, env);

    await addTrustReceiptEvent({
      receiptId: receipt.id,
      eventType: "verification_checked",
      eventLabel: "Verification failed — hash mismatch (tampered)",
      metadata: { result: "tampered" },
    }, env);

    await writeAuditLog(env, {
      eventType: "trust_receipt_verification_failed",
      appId: receipt.sourceAppId,
      metadata: { receiptId: receipt.id, receiptNumber: normalizedNumber, reason: "tampered" },
    });

    return buildPublicResponse(receipt, "tampered");
  }

  // Valid!
  await writeReceiptVerification({
    receiptId: receipt.id,
    receiptNumber: normalizedNumber,
    verificationResult: "valid",
    reason: null,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
  }, env);

  await addTrustReceiptEvent({
    receiptId: receipt.id,
    eventType: "receipt_verified",
    eventLabel: "Receipt verified successfully",
    metadata: { result: "valid" },
  }, env);

  await writeAuditLog(env, {
    eventType: "trust_receipt_verified",
    appId: receipt.sourceAppId,
    metadata: {
      receiptId: receipt.id,
      receiptNumber: normalizedNumber,
      receiptType: receipt.receiptType,
      riskLevel: receipt.riskLevel,
      status: receipt.status,
    },
  });

  try {
    await writeAppAccessLog(env, {
      appId: receipt.sourceAppId,
      userId: receipt.userId,
      tenantId: receipt.sourceTenantId,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "trust_receipt_verified", receiptId: receipt.id, receiptNumber: normalizedNumber },
    });
  } catch {
    // Non-fatal
  }

  return buildPublicResponse(receipt, "valid");
}

// ── Write verification attempt ────────────────────────────────

export async function writeReceiptVerification(
  input: WriteReceiptVerificationInput,
  env: Env
): Promise<void> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_trust_receipt_verifications
         (id, receipt_id, receipt_number, verification_result, reason, ip_address, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.receiptId ?? null,
      input.receiptNumber,
      input.verificationResult,
      input.reason ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    )
    .run();
}

// ── Public response builders ──────────────────────────────────

function buildPublicResponse(
  receipt: IdsTrustReceipt,
  result: TrustReceiptVerificationResult
): TrustProofPublicVerificationResponse {
  // SECURITY: Never expose private_metadata, user emails/phones, raw metadata, or internal IDs that are sensitive.
  return {
    receiptNumber: receipt.receiptNumber,
    verificationResult: result,
    receiptType: receipt.receiptType,
    sourceAppId: receipt.sourceAppId,
    riskLevel: receipt.riskLevel,
    status: receipt.status,
    outcome: receipt.outcome,
    publicSummary: receipt.publicSummary,
    createdAt: receipt.createdAt,
    finalizedAt: receipt.finalizedAt,
    fingerprint: buildReceiptPublicFingerprint(receipt.receiptHash),
  };
}

function buildPublicNotFoundResponse(
  receiptNumber: string
): TrustProofPublicVerificationResponse {
  return {
    receiptNumber,
    verificationResult: "not_found",
    receiptType: "system_event" as TrustReceiptType,
    sourceAppId: "unknown",
    riskLevel: "low" as TrustReceiptRiskLevel,
    status: "draft" as TrustReceiptStatus,
    outcome: null,
    publicSummary: null,
    createdAt: new Date().toISOString(),
    finalizedAt: null,
    fingerprint: "sha256:not_found",
  };
}

// ── Error classes ─────────────────────────────────────────────

export class TrustProofValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustProofValidationError";
  }
}

export class TrustProofNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrustProofNotFoundError";
  }
}
