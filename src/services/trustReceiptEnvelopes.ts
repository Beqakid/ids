/**
 * Trust Receipt Envelope Service — Phase 6
 *
 * Creates and manages draft TrustProof receipt envelopes.
 * This is NOT the full TrustProof engine.
 * Phase 6 only creates the draft envelope structure.
 *
 * TODO: Phase 7 — Full TrustProof Engine: finalization, receipt verification,
 *       receipt timeline, SMS proof asset hooks, and external proof links.
 *
 * TODO: Phase 7 — Envelope → TrustProof Receipt Linking:
 *       Call `createTrustReceiptFromEnvelope(envelopeId, ...)` in trustProof.ts
 *       to promote a Phase 6 envelope to a full Phase 7 TrustProof receipt.
 *       The receipt will inherit: receiptType, sourceAppId, sourceTenantId,
 *       userId, actionContextId, riskLevel, actionKey, and summary.
 *       The envelope is NOT deleted after linking; it remains as an audit artifact.
 *       Link can be queried via `ids_trust_receipts.envelope_id`.
 */

import type { Env } from "../types/env";
import type {
  IdsTrustReceiptEnvelope,
  IdsTrustReceiptEnvelopeRow,
  CreateTrustReceiptEnvelopeInput,
  FinalizeTrustReceiptEnvelopeInput,
  ListTrustReceiptEnvelopesOptions,
} from "../types/trustReceipts";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";

// ── Helper ────────────────────────────────────────────────────

function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObj(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToEnvelope(row: IdsTrustReceiptEnvelopeRow): IdsTrustReceiptEnvelope {
  return {
    id: row.id,
    receiptType: row.receipt_type as IdsTrustReceiptEnvelope["receiptType"],
    sourceAppId: row.source_app_id,
    sourceTenantId: row.source_tenant_id,
    userId: row.user_id,
    actionContextId: row.action_context_id,
    status: row.status as IdsTrustReceiptEnvelope["status"],
    riskLevel: row.risk_level,
    actionKey: row.action_key,
    summary: row.summary,
    proofLinks: parseJsonArray(row.proof_links),
    metadata: parseJsonObj(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finalizedAt: row.finalized_at,
  };
}

// ── Create ────────────────────────────────────────────────────

export async function createTrustReceiptEnvelope(
  input: CreateTrustReceiptEnvelopeInput,
  env: Env
): Promise<IdsTrustReceiptEnvelope> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_trust_receipt_envelopes
         (id, receipt_type, source_app_id, source_tenant_id, user_id,
          action_context_id, status, risk_level, action_key, summary,
          proof_links, metadata, created_at, updated_at, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, ?, ?, ?, NULL)`
    )
    .bind(
      id,
      input.receiptType,
      input.sourceAppId,
      input.sourceTenantId ?? null,
      input.userId ?? null,
      input.actionContextId ?? null,
      input.riskLevel ?? null,
      input.actionKey ?? null,
      input.summary ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "trust_receipt_envelope_created",
    userId: input.userId,
    appId: input.sourceAppId,
    tenantId: input.sourceTenantId,
    metadata: {
      receiptEnvelopeId: id,
      receiptType: input.receiptType,
      actionContextId: input.actionContextId,
      riskLevel: input.riskLevel,
      actionKey: input.actionKey,
    },
  });

  const row = await db
    .prepare("SELECT * FROM ids_trust_receipt_envelopes WHERE id = ?")
    .bind(id)
    .first<IdsTrustReceiptEnvelopeRow>();

  return rowToEnvelope(row!);
}

// ── Get by ID ─────────────────────────────────────────────────

export async function getTrustReceiptEnvelopeById(
  env: Env,
  id: string
): Promise<IdsTrustReceiptEnvelope | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_trust_receipt_envelopes WHERE id = ?")
    .bind(id)
    .first<IdsTrustReceiptEnvelopeRow>();
  if (!row) return null;
  return rowToEnvelope(row);
}

// ── List ──────────────────────────────────────────────────────

export async function listTrustReceiptEnvelopes(
  env: Env,
  opts: ListTrustReceiptEnvelopesOptions
): Promise<{ envelopes: IdsTrustReceiptEnvelope[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) { conditions.push("user_id = ?"); params.push(opts.userId); }
  if (opts.sourceAppId) { conditions.push("source_app_id = ?"); params.push(opts.sourceAppId); }
  if (opts.sourceTenantId) { conditions.push("source_tenant_id = ?"); params.push(opts.sourceTenantId); }
  if (opts.receiptType) { conditions.push("receipt_type = ?"); params.push(opts.receiptType); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_trust_receipt_envelopes ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_trust_receipt_envelopes ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsTrustReceiptEnvelopeRow>();

  return {
    envelopes: (rows.results ?? []).map(rowToEnvelope),
    total,
  };
}

// ── Finalize ──────────────────────────────────────────────────

export async function finalizeTrustReceiptEnvelope(
  env: Env,
  id: string,
  input: FinalizeTrustReceiptEnvelopeInput
): Promise<IdsTrustReceiptEnvelope | null> {
  const db = getDB(env);
  const existing = await getTrustReceiptEnvelopeById(env, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const proofLinks = input.proofLinks ?? null;

  await db
    .prepare(
      `UPDATE ids_trust_receipt_envelopes
       SET status = 'finalized',
           summary = COALESCE(?, summary),
           proof_links = ?,
           metadata = COALESCE(?, metadata),
           finalized_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      input.summary ?? null,
      proofLinks ? JSON.stringify(proofLinks) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
      id
    )
    .run();

  await writeAuditLog(env, {
    eventType: "trust_receipt_envelope_finalized",
    userId: existing.userId,
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    metadata: {
      receiptEnvelopeId: id,
      receiptType: existing.receiptType,
      actionContextId: existing.actionContextId,
    },
  });

  return getTrustReceiptEnvelopeById(env, id);
}

// ── Cancel ────────────────────────────────────────────────────

export async function cancelTrustReceiptEnvelope(
  env: Env,
  id: string,
  reason?: string | null
): Promise<IdsTrustReceiptEnvelope | null> {
  const db = getDB(env);
  const existing = await getTrustReceiptEnvelopeById(env, id);
  if (!existing) return null;

  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE ids_trust_receipt_envelopes
       SET status = 'canceled', updated_at = ?
       WHERE id = ?`
    )
    .bind(now, id)
    .run();

  await writeAuditLog(env, {
    eventType: "trust_receipt_envelope_canceled",
    userId: existing.userId,
    appId: existing.sourceAppId,
    tenantId: existing.sourceTenantId,
    metadata: {
      receiptEnvelopeId: id,
      receiptType: existing.receiptType,
      reason: reason ?? null,
    },
  });

  return getTrustReceiptEnvelopeById(env, id);
}
