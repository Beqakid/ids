import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { getUserTenantContext } from "../services/memberships";
import {
  getRoleKeysForUserContext,
  getPermissionsForUserContext,
} from "../services/permissionChecks";

const internalContext = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalContext.use("*", requireServiceAuth());

/**
 * GET /api/internal/context?userId=...&appId=...&tenantId=...
 * Returns the full user–app–tenant–membership context,
 * now including roles and effectivePermissions (Phase 4).
 * TODO: Phase 5 — protect with API key or service token.
 */
internalContext.get("/", async (c) => {
  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId");

  if (!userId || !appId || !tenantId) {
    return error(
      c,
      "MISSING_PARAMS",
      "userId, appId, and tenantId query parameters are required.",
      400
    );
  }

  const ctx = await getUserTenantContext(c.env, userId, appId, tenantId);

  // Phase 4: enrich with roles and effective permissions
  let roles: string[] = [];
  let effectivePermissions: string[] = [];

  if (ctx.active && ctx.membership) {
    roles = await getRoleKeysForUserContext(c.env, userId, appId, tenantId);
    effectivePermissions = await getPermissionsForUserContext(
      c.env,
      userId,
      appId,
      tenantId
    );
  }

  return success(c, {
    ...ctx,
    roles,
    effectivePermissions,
  });
});

export default internalContext;
