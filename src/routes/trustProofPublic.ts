/**
 * TrustProof Public Routes — Phase 7
 *
 * NO AUTH required for these routes.
 * Mounted at /api/public/trustproof in src/index.ts.
 *
 * SECURITY:
 * - Response shape is strictly limited: only safe public fields.
 * - private_metadata, user emails/phones, session data, tokens, OTP,
 *   and API key hashes are NEVER included in any response here.
 * - Every verification attempt is logged (rate limiting is infra-level).
 *
 * Public safe response shape:
 * { receiptNumber, verificationResult, receiptType, sourceAppId,
 *   riskLevel, status, outcome, publicSummary, createdAt, finalizedAt, fingerprint }
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { optionalString, isValidReceiptNumber, ValidationError } from "../lib/validation";
import { verifyTrustReceipt } from "../services/trustProof";

const trustProofPublicRoutes = new Hono<HonoEnv>();

// ── GET /api/public/trustproof/verify/:receiptNumber ──────────
// Verify a receipt by its number. No auth required.
// Logs every verification attempt regardless of outcome.

trustProofPublicRoutes.get("/verify/:receiptNumber", async (c) => {
  try {
    const receiptNumber = c.req.param("receiptNumber");

    if (!isValidReceiptNumber(receiptNumber)) {
      return error(
        c,
        "INVALID_RECEIPT_NUMBER",
        "Invalid receipt number format. Expected: TP-YYYYMMDD-APPKEY-000001",
        400
      );
    }

    const result = await verifyTrustReceipt(receiptNumber, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/public/trustproof/verify ───────────────────────
// Verify a receipt by its number (POST body). No auth required.
// Allows programmatic verification from external systems.

trustProofPublicRoutes.post("/verify", async (c) => {
  try {
    const body = await c.req.json();
    const receiptNumber = optionalString(body.receiptNumber);

    if (!receiptNumber) {
      return error(c, "VALIDATION_ERROR", "receiptNumber is required.", 400);
    }

    if (!isValidReceiptNumber(receiptNumber)) {
      return error(
        c,
        "INVALID_RECEIPT_NUMBER",
        "Invalid receipt number format. Expected: TP-YYYYMMDD-APPKEY-000001",
        400
      );
    }

    const result = await verifyTrustReceipt(receiptNumber, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

export default trustProofPublicRoutes;
