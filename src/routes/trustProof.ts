/**
 * TrustProof Routes (Protected) — Phase 7
 *
 * All routes require Bearer IDS JWT or x-ids-service-key.
 * Mounted at /api/trustproof in src/index.ts.
 *
 * SECURITY:
 * - private_metadata is NEVER returned in any response.
 * - All routes are service-auth protected.
 * - All mutations are audit-logged in the service layer.
 *
 * See /api/public/trustproof for public verification routes (trustProofPublic.ts).
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { requireServiceAuth } from "../middleware/auth";
import { success, error } from "../lib/response";
import {
  parseLimitOffset,
  requireString,
  optionalString,
  parseJsonMetadata,
  ValidationError,
  isValidTrustReceiptType,
  isValidTrustReceiptActionType,
  isValidTrustReceiptRiskLevel,
  isValidTrustReceiptOutcome,
  isValidTrustReceiptEventType,
  isValidProofLinkType,
  isValidProofProvider,
  isValidTrustReceiptStatus,
} from "../lib/validation";
import {
  createTrustReceipt,
  createTrustReceiptFromEnvelope,
  createTrustReceiptFromKaiActionContext,
  finalizeTrustReceipt,
  cancelTrustReceipt,
  voidTrustReceipt,
  getTrustReceiptById,
  getTrustReceiptByNumber,
  listTrustReceipts,
  addTrustReceiptEvent,
  listTrustReceiptEvents,
  addProofLinkToReceipt,
  removeProofLinkFromReceipt,
  listProofLinksForReceipt,
  TrustProofValidationError,
  TrustProofNotFoundError,
} from "../services/trustProof";
import type { CreateTrustReceiptInput, TrustReceiptType, TrustReceiptActionType, TrustReceiptRiskLevel, TrustReceiptOutcome } from "../types/trustProof";

const trustProofRoutes = new Hono<HonoEnv>();

// Apply service auth to all routes in this file
trustProofRoutes.use("*", requireServiceAuth());

// ── POST /api/trustproof/receipts ─────────────────────────────
// Create a new TrustProof receipt in draft status.

trustProofRoutes.post("/receipts", async (c) => {
  try {
    const body = await c.req.json();

    const receiptType = requireString(body.receiptType, "receiptType");
    const sourceAppId = requireString(body.sourceAppId, "sourceAppId");
    const summary = requireString(body.summary, "summary");

    if (!isValidTrustReceiptType(receiptType)) {
      return error(c, "INVALID_RECEIPT_TYPE", `Invalid receiptType: ${receiptType}`, 400);
    }

    const actionType = optionalString(body.actionType);
    if (actionType && !isValidTrustReceiptActionType(actionType)) {
      return error(c, "INVALID_ACTION_TYPE", `Invalid actionType: ${actionType}`, 400);
    }

    const riskLevel = optionalString(body.riskLevel) ?? "low";
    if (!isValidTrustReceiptRiskLevel(riskLevel)) {
      return error(c, "INVALID_RISK_LEVEL", `Invalid riskLevel: ${riskLevel}`, 400);
    }

    const outcome = optionalString(body.outcome);
    if (outcome && !isValidTrustReceiptOutcome(outcome)) {
      return error(c, "INVALID_OUTCOME", `Invalid outcome: ${outcome}`, 400);
    }

    const metadata = parseJsonMetadata(body.metadata);
    const privateMetadata = parseJsonMetadata(body.privateMetadata);

    const input: CreateTrustReceiptInput = {
      receiptType: receiptType as TrustReceiptType,
      sourceAppId,
      sourceTenantId: optionalString(body.sourceTenantId),
      userId: optionalString(body.userId),
      actorUserId: optionalString(body.actorUserId),
      subjectUserId: optionalString(body.subjectUserId),
      actionContextId: optionalString(body.actionContextId),
      envelopeId: optionalString(body.envelopeId),
      actionKey: optionalString(body.actionKey),
      actionLabel: optionalString(body.actionLabel),
      actionType: actionType as TrustReceiptActionType | undefined,
      riskLevel: riskLevel as TrustReceiptRiskLevel,
      outcome: outcome as TrustReceiptOutcome | undefined,
      summary,
      publicSummary: optionalString(body.publicSummary),
      metadata: metadata ?? undefined,
      privateMetadata: privateMetadata ?? undefined,
    };

    const receipt = await createTrustReceipt(input, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, { receipt }, 201);
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── POST /api/trustproof/receipts/from-envelope/:envelopeId ──
// Create a TrustProof receipt from a Phase 6 envelope.

trustProofRoutes.post("/receipts/from-envelope/:envelopeId", async (c) => {
  try {
    const envelopeId = c.req.param("envelopeId");
    const body = await c.req.json().catch(() => ({}));

    const metadata = parseJsonMetadata(body?.metadata);
    const privateMetadata = parseJsonMetadata(body?.privateMetadata);

    const receipt = await createTrustReceiptFromEnvelope(
      envelopeId,
      {
        summary: optionalString(body?.summary) ?? "Receipt created from envelope.",
        publicSummary: optionalString(body?.publicSummary) ?? undefined,
        metadata: metadata ?? undefined,
        privateMetadata: privateMetadata ?? undefined,
      },
      c.env,
      {
        ipAddress: c.req.header("CF-Connecting-IP"),
        userAgent: c.req.header("user-agent"),
      }
    );

    return success(c, { receipt }, 201);
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── POST /api/trustproof/receipts/from-kai-action/:actionContextId ──
// Create a TrustProof receipt from a Phase 6 Kai action context.

trustProofRoutes.post("/receipts/from-kai-action/:actionContextId", async (c) => {
  try {
    const actionContextId = c.req.param("actionContextId");
    const body = await c.req.json().catch(() => ({}));

    const metadata = parseJsonMetadata(body?.metadata);
    const privateMetadata = parseJsonMetadata(body?.privateMetadata);

    const receipt = await createTrustReceiptFromKaiActionContext(
      actionContextId,
      {
        summary: optionalString(body?.summary) ?? undefined,
        publicSummary: optionalString(body?.publicSummary) ?? undefined,
        metadata: metadata ?? undefined,
        privateMetadata: privateMetadata ?? undefined,
      },
      c.env,
      {
        ipAddress: c.req.header("CF-Connecting-IP"),
        userAgent: c.req.header("user-agent"),
      }
    );

    return success(c, { receipt }, 201);
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── GET /api/trustproof/receipts ──────────────────────────────
// List receipts with optional filters + pagination.

trustProofRoutes.get("/receipts", async (c) => {
  try {
    const { limit, offset } = parseLimitOffset(c.req.query("limit"), c.req.query("offset"));

    const receiptType = c.req.query("receiptType");
    if (receiptType && !isValidTrustReceiptType(receiptType)) {
      return error(c, "INVALID_RECEIPT_TYPE", `Invalid receiptType: ${receiptType}`, 400);
    }

    const status = c.req.query("status");
    if (status && !isValidTrustReceiptStatus(status)) {
      return error(c, "INVALID_STATUS", `Invalid status: ${status}`, 400);
    }

    const outcome = c.req.query("outcome");
    if (outcome && !isValidTrustReceiptOutcome(outcome)) {
      return error(c, "INVALID_OUTCOME", `Invalid outcome: ${outcome}`, 400);
    }

    const riskLevel = c.req.query("riskLevel");
    if (riskLevel && !isValidTrustReceiptRiskLevel(riskLevel)) {
      return error(c, "INVALID_RISK_LEVEL", `Invalid riskLevel: ${riskLevel}`, 400);
    }

    const result = await listTrustReceipts(c.env, {
      limit,
      offset,
      receiptType,
      sourceAppId: c.req.query("sourceAppId") ?? undefined,
      sourceTenantId: c.req.query("sourceTenantId") ?? undefined,
      userId: c.req.query("userId") ?? undefined,
      actorUserId: c.req.query("actorUserId") ?? undefined,
      subjectUserId: c.req.query("subjectUserId") ?? undefined,
      actionContextId: c.req.query("actionContextId") ?? undefined,
      status,
      outcome,
      riskLevel,
    });

    return success(c, { receipts: result.receipts, total: result.total, limit, offset });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/trustproof/receipts/:id ──────────────────────────
// Get a single receipt by UUID.

trustProofRoutes.get("/receipts/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const receipt = await getTrustReceiptById(c.env, id);
    if (!receipt) return error(c, "NOT_FOUND", "Receipt not found.", 404);
    return success(c, { receipt });
  } catch (err) {
    throw err;
  }
});

// ── GET /api/trustproof/receipts/number/:receiptNumber ────────
// Get a single receipt by its human-readable receipt number.

trustProofRoutes.get("/receipts/number/:receiptNumber", async (c) => {
  try {
    const receiptNumber = c.req.param("receiptNumber");
    const receipt = await getTrustReceiptByNumber(c.env, receiptNumber);
    if (!receipt) return error(c, "NOT_FOUND", "Receipt not found.", 404);
    return success(c, { receipt });
  } catch (err) {
    throw err;
  }
});

// ── POST /api/trustproof/receipts/:id/finalize ────────────────
// Transition a draft receipt to finalized.

trustProofRoutes.post("/receipts/:id/finalize", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));

    const outcome = optionalString(body?.outcome);
    if (outcome && !isValidTrustReceiptOutcome(outcome)) {
      return error(c, "INVALID_OUTCOME", `Invalid outcome: ${outcome}`, 400);
    }

    const receipt = await finalizeTrustReceipt(
      id,
      {
        outcome: outcome as TrustReceiptOutcome | undefined,
        summary: optionalString(body?.summary) ?? undefined,
        publicSummary: optionalString(body?.publicSummary) ?? undefined,
      },
      c.env,
      {
        ipAddress: c.req.header("CF-Connecting-IP"),
        userAgent: c.req.header("user-agent"),
      }
    );

    return success(c, { receipt });
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── POST /api/trustproof/receipts/:id/cancel ─────────────────
// Cancel a draft receipt (cannot cancel finalized receipts).

trustProofRoutes.post("/receipts/:id/cancel", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const reason = optionalString(body?.reason) ?? null;

    const receipt = await cancelTrustReceipt(id, reason, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, { receipt });
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── POST /api/trustproof/receipts/:id/void ────────────────────
// Void a finalized receipt (cannot void drafts).

trustProofRoutes.post("/receipts/:id/void", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const reason = optionalString(body?.reason) ?? null;

    const receipt = await voidTrustReceipt(id, reason, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, { receipt });
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── GET /api/trustproof/receipts/:id/events ───────────────────
// List all timeline events for a receipt.

trustProofRoutes.get("/receipts/:id/events", async (c) => {
  try {
    const id = c.req.param("id");
    const receipt = await getTrustReceiptById(c.env, id);
    if (!receipt) return error(c, "NOT_FOUND", "Receipt not found.", 404);

    const events = await listTrustReceiptEvents(c.env, id);
    return success(c, { events, total: events.length });
  } catch (err) {
    throw err;
  }
});

// ── POST /api/trustproof/receipts/:id/events ──────────────────
// Add a timeline event to a receipt.

trustProofRoutes.post("/receipts/:id/events", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const eventType = requireString(body.eventType, "eventType");
    const eventLabel = requireString(body.eventLabel, "eventLabel");

    if (!isValidTrustReceiptEventType(eventType)) {
      return error(c, "INVALID_EVENT_TYPE", `Invalid eventType: ${eventType}`, 400);
    }

    const receipt = await getTrustReceiptById(c.env, id);
    if (!receipt) return error(c, "NOT_FOUND", "Receipt not found.", 404);

    const metadata = parseJsonMetadata(body.metadata);

    const event = await addTrustReceiptEvent({
      receiptId: id,
      eventType: eventType as any,
      eventLabel,
      actorUserId: optionalString(body.actorUserId) ?? null,
      appId: optionalString(body.appId) ?? receipt.sourceAppId,
      tenantId: optionalString(body.tenantId) ?? receipt.sourceTenantId,
      status: optionalString(body.status) ?? null,
      metadata: metadata ?? null,
    }, c.env);

    // Emit audit for explicit event additions
    const { writeAuditLog } = await import("../services/audit");
    await writeAuditLog(c.env, {
      eventType: "trust_receipt_event_added",
      appId: receipt.sourceAppId,
      metadata: { receiptId: id, eventType, eventLabel },
    });

    return success(c, { event }, 201);
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── GET /api/trustproof/receipts/:id/proof-links ─────────────
// List all proof links attached to a receipt.

trustProofRoutes.get("/receipts/:id/proof-links", async (c) => {
  try {
    const id = c.req.param("id");
    const receipt = await getTrustReceiptById(c.env, id);
    if (!receipt) return error(c, "NOT_FOUND", "Receipt not found.", 404);

    const proofLinks = await listProofLinksForReceipt(c.env, id);
    return success(c, { proofLinks, total: proofLinks.length });
  } catch (err) {
    throw err;
  }
});

// ── POST /api/trustproof/receipts/:id/proof-links ────────────
// Attach a new proof link to a receipt.

trustProofRoutes.post("/receipts/:id/proof-links", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();

    const proofType = requireString(body.proofType, "proofType");
    if (!isValidProofLinkType(proofType)) {
      return error(c, "INVALID_PROOF_TYPE", `Invalid proofType: ${proofType}`, 400);
    }

    const provider = optionalString(body.provider) ?? "internal";
    if (!isValidProofProvider(provider)) {
      return error(c, "INVALID_PROVIDER", `Invalid provider: ${provider}`, 400);
    }

    const metadata = parseJsonMetadata(body.metadata);

    const proofLink = await addProofLinkToReceipt(
      {
        receiptId: id,
        proofType: proofType as any,
        provider: provider as any,
        externalRefId: optionalString(body.externalRefId) ?? null,
        url: optionalString(body.url) ?? null,
        label: optionalString(body.label) ?? null,
        description: optionalString(body.description) ?? null,
        contentHash: optionalString(body.contentHash) ?? null,
        metadata: metadata ?? null,
      },
      c.env,
      {
        ipAddress: c.req.header("CF-Connecting-IP"),
        userAgent: c.req.header("user-agent"),
      }
    );

    return success(c, { proofLink }, 201);
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

// ── POST /api/trustproof/proof-links/:id/remove ──────────────
// Mark a proof link as removed (soft delete).

trustProofRoutes.post("/proof-links/:id/remove", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const reason = optionalString(body?.reason) ?? null;

    const proofLink = await removeProofLinkFromReceipt(id, reason, c.env, {
      ipAddress: c.req.header("CF-Connecting-IP"),
      userAgent: c.req.header("user-agent"),
    });

    return success(c, { proofLink });
  } catch (err) {
    if (err instanceof TrustProofValidationError || err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    if (err instanceof TrustProofNotFoundError) {
      return error(c, "NOT_FOUND", err.message, 404);
    }
    throw err;
  }
});

export default trustProofRoutes;
