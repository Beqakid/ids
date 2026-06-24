import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidPermissionKey,
  isValidRiskLevel,
  isAllowedValue,
  parseLimitOffset,
  ValidationError,
} from "../lib/validation";
import {
  PERMISSION_STATUSES,
  type PermissionStatus,
} from "../types/permissions";
import {
  createPermission,
  getPermissionById,
  getPermissionByKey,
  listPermissions,
  updatePermission,
  updatePermissionStatus,
  DuplicatePermissionKeyError,
} from "../services/permissions";

const internalPermissions = new Hono<HonoEnv>();

// ── GET /api/internal/permissions ────────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const appId = c.req.query("appId");
  const category = c.req.query("category");
  const riskLevel = c.req.query("riskLevel");
  const status = c.req.query("status");

  const result = await listPermissions(c.env, {
    limit, offset, appId, category, riskLevel, status,
  });

  return success(c, { permissions: result.permissions, total: result.total });
});

// ── GET /api/internal/permissions/:id ────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.get("/:id", async (c) => {
  const id = c.req.param("id");

  // Try by ID first, then by key
  let permission = await getPermissionById(c.env, id);
  if (!permission) {
    permission = await getPermissionByKey(c.env, id);
  }
  if (!permission) {
    return error(c, "PERMISSION_NOT_FOUND", "Permission not found.", 404);
  }

  return success(c, { permission });
});

// ── GET /api/internal/permissions/key/:permissionKey ─────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.get("/key/:permissionKey", async (c) => {
  const permissionKey = c.req.param("permissionKey");
  const permission = await getPermissionByKey(c.env, permissionKey);
  if (!permission) {
    return error(c, "PERMISSION_NOT_FOUND", "Permission not found.", 404);
  }
  return success(c, { permission });
});

// ── POST /api/internal/permissions ───────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const permissionKey = requireString(body.permissionKey, "permissionKey");
    const name = requireString(body.name, "name");
    const description = optionalString(body.description);
    const category = optionalString(body.category);
    const appId = optionalString(body.appId);
    const riskLevel = optionalString(body.riskLevel);
    const status = optionalString(body.status);

    if (!isValidPermissionKey(permissionKey)) {
      return error(
        c, "INVALID_PERMISSION_KEY",
        "permissionKey must be lowercase dot notation with at least one dot.", 400
      );
    }
    if (riskLevel && !isValidRiskLevel(riskLevel)) {
      return error(c, "INVALID_RISK_LEVEL", "Invalid riskLevel. Allowed: low, medium, high, blocked.", 400);
    }
    if (status && !isAllowedValue(status, PERMISSION_STATUSES)) {
      return error(c, "INVALID_STATUS", `Invalid status. Allowed: ${PERMISSION_STATUSES.join(", ")}`, 400);
    }

    const permission = await createPermission(c.env, {
      permissionKey, name, description, category, appId, riskLevel, status,
    });

    return success(c, { permission }, 201);
  } catch (err) {
    if (err instanceof DuplicatePermissionKeyError) {
      return error(c, "DUPLICATE_PERMISSION_KEY", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/permissions/:id ──────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.patch("/:id", async (c) => {
  try {
    const permissionId = c.req.param("id");
    const body = await c.req.json();
    const name = optionalString(body.name);
    const description = body.description !== undefined ? body.description : undefined;
    const category = body.category !== undefined ? body.category : undefined;
    const riskLevel = optionalString(body.riskLevel);

    if (riskLevel && !isValidRiskLevel(riskLevel)) {
      return error(c, "INVALID_RISK_LEVEL", "Invalid riskLevel.", 400);
    }

    const permission = await updatePermission(c.env, {
      permissionId, name, description, category, riskLevel,
    });

    if (!permission) {
      return error(c, "PERMISSION_NOT_FOUND", "Permission not found.", 404);
    }

    return success(c, { permission });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/permissions/:id/status ───────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalPermissions.patch("/:id/status", async (c) => {
  try {
    const permissionId = c.req.param("id");
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, PERMISSION_STATUSES)) {
      return error(c, "INVALID_STATUS", `Invalid status. Allowed: ${PERMISSION_STATUSES.join(", ")}`, 400);
    }

    const permission = await updatePermissionStatus(
      c.env, permissionId, status as PermissionStatus
    );

    if (!permission) {
      return error(c, "PERMISSION_NOT_FOUND", "Permission not found.", 404);
    }

    return success(c, { permission });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

export default internalPermissions;
