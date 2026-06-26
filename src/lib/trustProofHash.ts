/**
 * TrustProof Hash Utility — Phase 7
 *
 * Worker-compatible SHA-256 hashing for receipt integrity.
 * Uses the Web Crypto API only (no Node.js crypto).
 *
 * Rules:
 * - Hash is deterministic from canonical immutable fields.
 * - private_metadata is NEVER included in the public hash.
 * - Mutable timeline events are NOT included in the base receipt hash.
 * - finalized_at IS included when available (recomputed on finalization).
 *
 * TODO (Phase 8+): Consider a hash chain or Merkle-style approach
 *   where each new receipt links to the previous one via previous_receipt_hash,
 *   enabling tamper-evident audit trails across receipt history.
 */

import type { IdsTrustReceipt } from "../types/trustProof";

// ── Canonical payload builder ─────────────────────────────────

/**
 * Fields included in the receipt hash.
 * These must be immutable after finalization.
 * Order is deterministic (alphabetical on field name).
 */
export interface CanonicalReceiptPayload {
  action_key: string | null;
  action_type: string | null;
  actor_user_id: string | null;
  created_at: string;
  finalized_at: string | null;
  outcome: string | null;
  receipt_number: string;
  receipt_type: string;
  risk_level: string;
  source_app_id: string;
  source_tenant_id: string | null;
  subject_user_id: string | null;
  summary: string;
  user_id: string | null;
}

export function canonicalizeReceiptPayload(
  input: Pick<
    IdsTrustReceipt,
    | "receiptNumber"
    | "receiptType"
    | "sourceAppId"
    | "sourceTenantId"
    | "userId"
    | "actorUserId"
    | "subjectUserId"
    | "actionKey"
    | "actionType"
    | "riskLevel"
    | "outcome"
    | "summary"
    | "createdAt"
    | "finalizedAt"
  >
): CanonicalReceiptPayload {
  return {
    action_key: input.actionKey ?? null,
    action_type: input.actionType ?? null,
    actor_user_id: input.actorUserId ?? null,
    created_at: input.createdAt,
    finalized_at: input.finalizedAt ?? null,
    outcome: input.outcome ?? null,
    receipt_number: input.receiptNumber,
    receipt_type: input.receiptType,
    risk_level: input.riskLevel,
    source_app_id: input.sourceAppId,
    source_tenant_id: input.sourceTenantId ?? null,
    subject_user_id: input.subjectUserId ?? null,
    summary: input.summary,
    user_id: input.userId ?? null,
  };
}

// ── Deterministic JSON serializer ─────────────────────────────

/**
 * Stable JSON serialization with sorted keys.
 * Produces the same string for the same logical object, regardless of insertion order.
 */
export function safeStringifyCanonical(input: unknown): string {
  return JSON.stringify(input, (_key, value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce(
          (acc, k) => {
            acc[k] = (value as Record<string, unknown>)[k];
            return acc;
          },
          {} as Record<string, unknown>
        );
    }
    return value;
  });
}

// ── SHA-256 hash via Web Crypto ───────────────────────────────

/**
 * Compute a hex-encoded SHA-256 hash of the given string.
 * Worker-compatible: uses globalThis.crypto (Web Crypto API).
 */
export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(data);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Hash payload ──────────────────────────────────────────────

/**
 * Hash the canonical receipt payload and return a hex string.
 */
export async function hashReceiptPayload(
  input: Parameters<typeof canonicalizeReceiptPayload>[0]
): Promise<string> {
  const canonical = canonicalizeReceiptPayload(input);
  const serialized = safeStringifyCanonical(canonical);
  return sha256Hex(serialized);
}

// ── Verify a stored receipt hash ──────────────────────────────

/**
 * Recompute the receipt hash and compare against the stored value.
 * Returns true if they match (receipt is valid), false if tampered.
 */
export async function verifyReceiptHash(
  receipt: Pick<
    IdsTrustReceipt,
    | "receiptNumber"
    | "receiptType"
    | "sourceAppId"
    | "sourceTenantId"
    | "userId"
    | "actorUserId"
    | "subjectUserId"
    | "actionKey"
    | "actionType"
    | "riskLevel"
    | "outcome"
    | "summary"
    | "createdAt"
    | "finalizedAt"
    | "receiptHash"
  >
): Promise<boolean> {
  const recomputed = await hashReceiptPayload(receipt);
  return recomputed === receipt.receiptHash;
}

// ── Public fingerprint ────────────────────────────────────────

/**
 * Build a public-safe fingerprint string for the receipt.
 * Exposes only the receipt hash in a labeled format — no private data.
 *
 * Format: sha256:<hex>
 */
export function buildReceiptPublicFingerprint(receiptHash: string): string {
  return `sha256:${receiptHash}`;
}
