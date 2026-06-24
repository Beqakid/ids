import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  parseLimitOffset,
  parseJsonMetadata,
  ValidationError,
} from "../lib/validation";
import {
  checkPermission,
  listPermissionChecks,
  getPermissionsForUserContext,
} from "../services/permissionChecks";

const internalPermissionChecks = new Hono<HonoEnv>();

// ── POST /api/internal/permission-checks ─────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissionChecks.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const userId = requireString(body.userId, "userId");
    const appId = requireString(body.appId, "appId");
    const tenantId = optionalString(body.tenantId) ?? null;
    const permissionKey = requireString(body.permissionKey, "permissionKey");
    const source = optionalString(body.source) ?? "internal_api";
    const metadata = parseJsonMetadata(body.metadata);

    const result = await checkPermission(c.env, {
      userId, appId, tenantId, permissionKey, source, metadata,
    });

    return success(c, {
      allowed: result.allowed,
      reason: result.reason,
      riskLevel: result.riskLevel,
      matchedRoles: result.matchedRoles,
      permissionKey: result.permissionKey,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/internal/permission-checks ──────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissionChecks.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId");
  const permissionKey = c.req.query("permissionKey");
  const allowed = c.req.query("allowed");

  const result = await listPermissionChecks(c.env, {
    limit, offset, userId, appId, tenantId, permissionKey, allowed,
  });

  return success(c, { checks: result.checks, total: result.total });
});

export default internalPermissionChecks;
