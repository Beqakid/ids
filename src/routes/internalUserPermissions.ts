import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { getUserById } from "../services/users";
import { getPermissionsForUserContext } from "../services/permissionChecks";

const internalUserPermissions = new Hono<HonoEnv>();

// ── GET /api/internal/users/:id/permissions ──────────────────
// TODO: Phase 5 — protect with API key, signed JWT, or service-to-service authorization.
internalUserPermissions.get("/:id/permissions", async (c) => {
  const userId = c.req.param("id");
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId") ?? null;

  if (!appId) {
    return error(c, "MISSING_PARAMS", "appId query parameter is required.", 400);
  }

  const user = await getUserById(c.env, userId);
  if (!user) {
    return error(c, "USER_NOT_FOUND", "User not found.", 404);
  }

  const permissions = await getPermissionsForUserContext(
    c.env, userId, appId, tenantId
  );

  return success(c, { userId, appId, tenantId, permissions });
});

export default internalUserPermissions;
