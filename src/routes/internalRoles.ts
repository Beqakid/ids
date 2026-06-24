import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidRoleKey,
  isValidRoleScope,
  isAllowedValue,
  parseLimitOffset,
  ValidationError,
} from "../lib/validation";
import { ROLE_STATUSES, type RoleStatus } from "../types/roles";
import {
  createRole,
  getRoleById,
  listRoles,
  updateRole,
  updateRoleStatus,
  assignPermissionToRole,
  removePermissionFromRole,
  listPermissionsForRole,
  DuplicateRoleError,
  DuplicateRolePermissionError,
} from "../services/roles";
import { getPermissionByKey } from "../services/permissions";

const internalRoles = new Hono<HonoEnv>();

// ── GET /api/internal/roles ──────────────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId");
  const scope = c.req.query("scope");
  const status = c.req.query("status");

  const result = await listRoles(c.env, {
    limit, offset, appId, tenantId, scope, status,
  });

  return success(c, { roles: result.roles, total: result.total });
});

// ── GET /api/internal/roles/:id ──────────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.get("/:id", async (c) => {
  const roleId = c.req.param("id");
  const role = await getRoleById(c.env, roleId);
  if (!role) {
    return error(c, "ROLE_NOT_FOUND", "Role not found.", 404);
  }
  return success(c, { role });
});

// ── POST /api/internal/roles ─────────────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const roleKey = requireString(body.roleKey, "roleKey");
    const name = requireString(body.name, "name");
    const scope = requireString(body.scope, "scope");
    const description = optionalString(body.description);
    const appId = optionalString(body.appId) ?? null;
    const tenantId = optionalString(body.tenantId) ?? null;
    const status = optionalString(body.status);

    if (!isValidRoleKey(roleKey)) {
      return error(c, "INVALID_ROLE_KEY", "roleKey must be lowercase snake_case.", 400);
    }
    if (!isValidRoleScope(scope)) {
      return error(c, "INVALID_SCOPE", "scope must be global, app, or tenant.", 400);
    }
    if (status && !isAllowedValue(status, ROLE_STATUSES)) {
      return error(c, "INVALID_STATUS", `Invalid status. Allowed: ${ROLE_STATUSES.join(", ")}`, 400);
    }

    const role = await createRole(c.env, {
      roleKey, name, description, scope, appId, tenantId, status,
    });

    return success(c, { role }, 201);
  } catch (err) {
    if (err instanceof DuplicateRoleError) {
      return error(c, "DUPLICATE_ROLE", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/roles/:id ────────────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.patch("/:id", async (c) => {
  try {
    const roleId = c.req.param("id");
    const body = await c.req.json();
    const name = optionalString(body.name);
    const description = body.description !== undefined ? body.description : undefined;

    const role = await updateRole(c.env, { roleId, name, description });
    if (!role) {
      return error(c, "ROLE_NOT_FOUND", "Role not found.", 404);
    }

    return success(c, { role });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/roles/:id/status ─────────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.patch("/:id/status", async (c) => {
  try {
    const roleId = c.req.param("id");
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, ROLE_STATUSES)) {
      return error(c, "INVALID_STATUS", `Invalid status. Allowed: ${ROLE_STATUSES.join(", ")}`, 400);
    }

    const role = await updateRoleStatus(c.env, roleId, status as RoleStatus);
    if (!role) {
      return error(c, "ROLE_NOT_FOUND", "Role not found.", 404);
    }

    return success(c, { role });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/internal/roles/:id/permissions ──────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.get("/:id/permissions", async (c) => {
  const roleId = c.req.param("id");
  const role = await getRoleById(c.env, roleId);
  if (!role) {
    return error(c, "ROLE_NOT_FOUND", "Role not found.", 404);
  }

  const permissions = await listPermissionsForRole(c.env, roleId);
  return success(c, { permissions });
});

// ── POST /api/internal/roles/:id/permissions ─────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.post("/:id/permissions", async (c) => {
  try {
    const roleId = c.req.param("id");
    const body = await c.req.json();
    const permissionKey = requireString(body.permissionKey, "permissionKey");
    const createdByUserId = optionalString(body.createdByUserId);

    // Look up permission by key
    const permission = await getPermissionByKey(c.env, permissionKey);
    if (!permission) {
      return error(c, "PERMISSION_NOT_FOUND", `Permission '${permissionKey}' not found.`, 404);
    }

    const result = await assignPermissionToRole(
      c.env, roleId, permission.id, createdByUserId
    );

    return success(c, { rolePermissionId: result.id }, 201);
  } catch (err) {
    if (err instanceof DuplicateRolePermissionError) {
      return error(c, "DUPLICATE_ROLE_PERMISSION", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/internal/roles/:id/permissions/remove ──────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalRoles.post("/:id/permissions/remove", async (c) => {
  try {
    const roleId = c.req.param("id");
    const body = await c.req.json();
    const permissionKey = requireString(body.permissionKey, "permissionKey");

    const permission = await getPermissionByKey(c.env, permissionKey);
    if (!permission) {
      return error(c, "PERMISSION_NOT_FOUND", `Permission '${permissionKey}' not found.`, 404);
    }

    const removed = await removePermissionFromRole(c.env, roleId, permission.id);
    if (!removed) {
      return error(c, "MAPPING_NOT_FOUND", "This permission is not assigned to this role.", 404);
    }

    return success(c, { removed: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

export default internalRoles;
