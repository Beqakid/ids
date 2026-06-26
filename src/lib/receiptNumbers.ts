/**
 * Receipt Number Utility — Phase 7
 *
 * Generates unique, deterministic TrustProof receipt numbers.
 *
 * Format: TP-YYYYMMDD-APPKEY-000001
 * Example: TP-20260625-VILINIU-000001
 *
 * Rules:
 * - Receipt numbers must be globally unique.
 * - Counter is per (date + app) key, stored in ids_trust_receipt_counters.
 * - Counter increments atomically using D1 batch operations.
 * - App key is uppercased and truncated to 12 chars for readability.
 * - Sequence number is zero-padded to 6 digits.
 */

import type { D1Database } from "@cloudflare/workers-types";

const MAX_APP_KEY_LEN = 12;
const SEQ_PAD = 6;

/**
 * Normalize a receipt number: uppercase, trim whitespace.
 */
export function normalizeReceiptNumber(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * Format today's date as YYYYMMDD in UTC.
 */
function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Derive a short app key from a source_app_id string.
 * Strips underscores, uppercases, truncates to MAX_APP_KEY_LEN.
 *
 * Examples:
 *   command_center → COMMANDCENT
 *   viliniu        → VILINIU
 *   kai            → KAI
 */
function deriveAppKey(sourceAppId: string): string {
  return sourceAppId
    .replace(/_/g, "")
    .toUpperCase()
    .slice(0, MAX_APP_KEY_LEN);
}

/**
 * Generate a unique receipt number for the given receipt type and source app.
 *
 * Uses an atomic increment pattern on ids_trust_receipt_counters:
 *   1. INSERT OR IGNORE (init counter if missing)
 *   2. UPDATE (increment)
 *   3. SELECT current value
 *
 * The counter key is `{dateStr}:{appKey}` for easy partitioning.
 */
export async function generateReceiptNumber(
  db: D1Database,
  _receiptType: string,
  sourceAppId: string
): Promise<string> {
  const dateStr = getTodayDateStr();
  const appKey = deriveAppKey(sourceAppId);
  const counterKey = `${dateStr}:${appKey}`;
  const now = new Date().toISOString();

  // Atomic init + increment via D1 batch
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO ids_trust_receipt_counters
           (counter_key, current_value, updated_at)
         VALUES (?, 0, ?)`
      )
      .bind(counterKey, now),
    db
      .prepare(
        `UPDATE ids_trust_receipt_counters
         SET current_value = current_value + 1, updated_at = ?
         WHERE counter_key = ?`
      )
      .bind(now, counterKey),
  ]);

  // Read the incremented value
  const row = await db
    .prepare(
      `SELECT current_value FROM ids_trust_receipt_counters WHERE counter_key = ?`
    )
    .bind(counterKey)
    .first<{ current_value: number }>();

  const seq = row?.current_value ?? 1;
  const seqStr = String(seq).padStart(SEQ_PAD, "0");

  return `TP-${dateStr}-${appKey}-${seqStr}`;
}
