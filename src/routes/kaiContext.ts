/**
 * Kai Context Routes — Phase 6
 *
 * Mounted at /api/kai
 * All routes are protected by Phase 5 auth.
 * Does NOT execute Kai actions.
 * Does NOT call external APIs.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { requireServiceAuth } from "../middleware/auth";
import { success, error } from "../lib/response";
import {
  parseLimitOffset,
  requireString,
  isValidKaiActionType,
  isValidKaiRiskLevel,
  isValidKaiActionStatus,
  isValidActionKey,
} from "../lib/validation";
import {
  prepareKaiActionContext,
  getKaiActionContextById,
  listKaiActionContexts,
  buildKaiContextPayload,
} from "../services/kaiContext";

const kaiContextRoutes = new Hono<HonoEnv>();

// ── POST /api/kai/action-contexts/prepare ─────────────────────
// Prepare a Kai action context. Does NOT execute the action.

kaiContextRoutes.post(
  "/action-contexts/prepare",
  requireServiceAuth(),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return error(c, "VALIDATION_ERROR", "Request body must be valid JSON.", 400);
    }

    const b = body as Record<string, unknown>;

    let userId: string;
    let appId: string;
    let actionKey: string;
    let actionLabel: string;
    let actionType: string;

    try {
      userId = requireString(b.userId, "userId");
      appId = requireString(b.appId, "appId");
      actionKey = requireString(b.actionKey, "actionKey");
      actionLabel = requireString(b.actionLabel, "actionLabel");
      actionType = requireString(b.actionType, "actionType");
    } catch (err: unknown) {
      return error(c, "VALIDATION_ERROR", (err as Error).message, 400);
    }

    if (!isValidActionKey(actionKey)) {
      return error(
        c,
        "VALIDATION_ERROR",
        "actionKey must be non-empty and contain only lowercase letters, numbers, underscores, hyphens, and dots.",
        400
      );
    }

    if (!isValidKaiActionType(actionType)) {
      return error(
        c,
        "VALIDATION_ERROR",
        "actionType must be one of: explain, draft, prepare, dispatch, update, delete, verify, review, approve, reject, system.",
        400
      );
    }

    const riskLevel = (b.riskLevel as string | undefined) ?? "low";
    if (!isValidKaiRiskLevel(riskLevel)) {
      return error(
        c,
        "VALIDATION_ERROR",
        "riskLevel must be one of: low, medium, high, blocked.",
        400
      );
    }

    const tenantId =
      typeof b.tenantId === "string" && b.tenantId.trim().length > 0
        ? b.tenantId.trim()
        : null;
    const permissionKey =
      typeof b.permissionKey === "string" && b.permissionKey.trim().length > 0
        ? b.permissionKey.trim()
        : null;
    const metadata =
      b.metadata && typeof b.metadata === "object" && !Array.isArray(b.metadata)
        ? (b.metadata as Record<string, unknown>)
        : null;

    const authCtx = c.get("authContext")!;

    const result = await prepareKaiActionContext(
      {
        userId,
        appId,
        tenantId,
        actionKey,
        actionLabel,
        actionType: actionType as import("../types/kaiContext").KaiActionType,
        riskLevel: riskLevel as import("../types/kaiContext").KaiRiskLevel,
        permissionKey,
        metadata,
      },
      c.env,
      {
        ipAddress: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("user-agent") ?? null,
        clientId: authCtx.principalType === "service" ? (authCtx.clientId ?? null) : null,
      }
    );

    return success(c, result, 201);
  }
);

// ── GET /api/kai/action-contexts/:id ──────────────────────────

kaiContextRoutes.get(
  "/action-contexts/:id",
  requireServiceAuth(),
  async (c) => {
    const id = c.req.param("id");
    const ctx = await getKaiActionContextById(c.env, id);
    if (!ctx) {
      return error(c, "NOT_FOUND", "Kai action context not found.", 404);
    }
    return success(c, { actionContext: ctx });
  }
);

// ── GET /api/kai/action-contexts ──────────────────────────────

kaiContextRoutes.get("/action-contexts", requireServiceAuth(), async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );

  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId");
  const statusRaw = c.req.query("status");
  const riskLevelRaw = c.req.query("riskLevel");

  if (statusRaw && !isValidKaiActionStatus(statusRaw)) {
    return error(
      c,
      "VALIDATION_ERROR",
      "status must be one of: prepared, confirmation_required, admin_approval_required, allowed, denied, expired, canceled.",
      400
    );
  }
  if (riskLevelRaw && !isValidKaiRiskLevel(riskLevelRaw)) {
    return error(c, "VALIDATION_ERROR", "riskLevel must be one of: low, medium, high, blocked.", 400);
  }

  const { contexts, total } = await listKaiActionContexts(c.env, {
    limit,
    offset,
    userId,
    appId,
    tenantId,
    status: statusRaw,
    riskLevel: riskLevelRaw,
  });

  return success(c, { actionContexts: contexts, total, limit, offset });
});

// ── POST /api/kai/context ─────────────────────────────────────
// Build a Kai-ready context payload for a user/app/tenant.

kaiContextRoutes.post("/context", requireServiceAuth(), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return error(c, "VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }

  const b = body as Record<string, unknown>;

  let userId: string;
  let appId: string;

  try {
    userId = requireString(b.userId, "userId");
    appId = requireString(b.appId, "appId");
  } catch (err: unknown) {
    return error(c, "VALIDATION_ERROR", (err as Error).message, 400);
  }

  const tenantId =
    typeof b.tenantId === "string" && b.tenantId.trim().length > 0
      ? b.tenantId.trim()
      : null;

  const authCtx = c.get("authContext")!;

  try {
    const payload = await buildKaiContextPayload(
      {
        userId,
        appId,
        tenantId,
        requesterType:
          authCtx.principalType === "service" ? "kai" : "internal",
        requesterClientId:
          authCtx.principalType === "service" ? (authCtx.clientId ?? null) : null,
        ipAddress: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("user-agent") ?? null,
      },
      c.env
    );

    return success(c, { context: payload });
  } catch (err: unknown) {
    return error(
      c,
      "NOT_FOUND",
      err instanceof Error ? err.message : "Context could not be built.",
      404
    );
  }
});

export default kaiContextRoutes;
