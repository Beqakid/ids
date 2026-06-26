/**
 * Trust Receipt Envelope Routes — Phase 6
 *
 * Mounted at /api/internal/trust-receipts
 * All routes are protected by service auth (Phase 5).
 *
 * This is NOT the full TrustProof engine.
 * Phase 6 only manages draft receipt envelope structures.
 *
 * TODO: Phase 7 — Full TrustProof Engine: finalization receipts,
 *       receipt verification, timeline, and SMS proof asset hooks.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { requireServiceAuth } from "../middleware/auth";
import { success, error } from "../lib/response";
import {
  parseLimitOffset,
  requireString,
  isValidTrustReceiptType,
  isValidTrustReceiptEnvelopeStatus,
} from "../lib/validation";
import {
  createTrustReceiptEnvelope,
  getTrustReceiptEnvelopeById,
  listTrustReceiptEnvelopes,
  finalizeTrustReceiptEnvelope,
  cancelTrustReceiptEnvelope,
} from "../services/trustReceiptEnvelopes";

const trustReceiptRoutes = new Hono<HonoEnv>();

// Apply service auth to all routes
trustReceiptRoutes.use("*", requireServiceAuth());

// ── POST /api/internal/trust-receipts/envelopes ───────────────

trustReceiptRoutes.post("/envelopes", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return error(c, "VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }

  const b = body as Record<string, unknown>;

  let receiptType: string;
  let sourceAppId: string;

  try {
    receiptType = requireString(b.receiptType, "receiptType");
    sourceAppId = requireString(b.sourceAppId, "sourceAppId");
  } catch (err: unknown) {
    return error(c, "VALIDATION_ERROR", (err as Error).message, 400);
  }

  if (!isValidTrustReceiptType(receiptType)) {
    return error(
      c,
      "VALIDATION_ERROR",
      "receiptType must be one of: kai_action, permission_check, verification, media_proof, admin_action, system_event.",
      400
    );
  }

  const sourceTenantId =
    typeof b.sourceTenantId === "string" && b.sourceTenantId.trim().length > 0
      ? b.sourceTenantId.trim()
      : null;
  const userId =
    typeof b.userId === "string" && b.userId.trim().length > 0
      ? b.userId.trim()
      : null;
  const actionContextId =
    typeof b.actionContextId === "string" && b.actionContextId.trim().length > 0
      ? b.actionContextId.trim()
      : null;
  const riskLevel =
    typeof b.riskLevel === "string" && b.riskLevel.trim().length > 0
      ? b.riskLevel.trim()
      : null;
  const actionKey =
    typeof b.actionKey === "string" && b.actionKey.trim().length > 0
      ? b.actionKey.trim()
      : null;
  const summary =
    typeof b.summary === "string" && b.summary.trim().length > 0
      ? b.summary.trim()
      : null;
  const metadata =
    b.metadata && typeof b.metadata === "object" && !Array.isArray(b.metadata)
      ? (b.metadata as Record<string, unknown>)
      : null;

  const envelope = await createTrustReceiptEnvelope(
    {
      receiptType: receiptType as import("../types/trustReceipts").TrustReceiptType,
      sourceAppId,
      sourceTenantId,
      userId,
      actionContextId,
      riskLevel,
      actionKey,
      summary,
      metadata,
    },
    c.env
  );

  return success(c, { envelope }, 201);
});

// ── GET /api/internal/trust-receipts/envelopes/:id ────────────

trustReceiptRoutes.get("/envelopes/:id", async (c) => {
  const id = c.req.param("id");
  const envelope = await getTrustReceiptEnvelopeById(c.env, id);
  if (!envelope) {
    return error(c, "NOT_FOUND", "Trust receipt envelope not found.", 404);
  }
  return success(c, { envelope });
});

// ── GET /api/internal/trust-receipts/envelopes ────────────────

trustReceiptRoutes.get("/envelopes", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );

  const userId = c.req.query("userId");
  const sourceAppId = c.req.query("sourceAppId");
  const sourceTenantId = c.req.query("sourceTenantId");
  const receiptType = c.req.query("receiptType");
  const status = c.req.query("status");

  if (receiptType && !isValidTrustReceiptType(receiptType)) {
    return error(
      c,
      "VALIDATION_ERROR",
      "receiptType must be one of: kai_action, permission_check, verification, media_proof, admin_action, system_event.",
      400
    );
  }
  if (status && !isValidTrustReceiptEnvelopeStatus(status)) {
    return error(
      c,
      "VALIDATION_ERROR",
      "status must be one of: draft, finalized, canceled, expired.",
      400
    );
  }

  const { envelopes, total } = await listTrustReceiptEnvelopes(c.env, {
    limit,
    offset,
    userId,
    sourceAppId,
    sourceTenantId,
    receiptType,
    status,
  });

  return success(c, { envelopes, total, limit, offset });
});

// ── POST /api/internal/trust-receipts/envelopes/:id/finalize ──

trustReceiptRoutes.post("/envelopes/:id/finalize", async (c) => {
  const id = c.req.param("id");

  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    // body is optional
  }

  const summary =
    typeof body.summary === "string" && body.summary.trim().length > 0
      ? body.summary.trim()
      : null;
  const proofLinks = Array.isArray(body.proofLinks)
    ? (body.proofLinks as string[])
    : null;
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : null;

  const envelope = await finalizeTrustReceiptEnvelope(c.env, id, {
    summary,
    proofLinks,
    metadata,
  });

  if (!envelope) {
    return error(c, "NOT_FOUND", "Trust receipt envelope not found.", 404);
  }

  return success(c, { envelope });
});

// ── POST /api/internal/trust-receipts/envelopes/:id/cancel ────

trustReceiptRoutes.post("/envelopes/:id/cancel", async (c) => {
  const id = c.req.param("id");

  let reason: string | null = null;
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    if (typeof body.reason === "string" && body.reason.trim().length > 0) {
      reason = body.reason.trim();
    }
  } catch {
    // reason is optional
  }

  const envelope = await cancelTrustReceiptEnvelope(c.env, id, reason);

  if (!envelope) {
    return error(c, "NOT_FOUND", "Trust receipt envelope not found.", 404);
  }

  return success(c, { envelope });
});

export default trustReceiptRoutes;
