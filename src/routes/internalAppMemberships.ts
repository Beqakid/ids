import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { getAppByIdSilent } from "../services/apps";
import { getTenantByKey } from "../services/tenants";
import { listMembershipsForApp } from "../services/memberships";

const internalAppRoutes = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalAppRoutes.use("*", requireServiceAuth());

/**
 * GET /api/internal/apps/:appId/memberships
 * List memberships for a specific app.
 */
internalAppRoutes.get("/:appId/memberships", async (c) => {
  const appId = c.req.param("appId");
  const app = await getAppByIdSilent(c.env, appId);
  if (!app) {
    return error(c, "APP_NOT_FOUND", "App not found.", 404);
  }

  const memberships = await listMembershipsForApp(c.env, appId);

  return success(c, {
    memberships: memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      appId: m.appId,
      tenantId: m.tenantId,
      roleKey: m.roleKey,
      status: m.status,
      joinedAt: m.joinedAt,
      createdAt: m.createdAt,
    })),
  });
});

/**
 * GET /api/internal/apps/:appId/tenants/:tenantKey
 * Look up a tenant by app_id + tenant_key.
 */
internalAppRoutes.get("/:appId/tenants/:tenantKey", async (c) => {
  const appId = c.req.param("appId");
  const tenantKey = c.req.param("tenantKey");

  const tenant = await getTenantByKey(c.env, appId, tenantKey);
  if (!tenant) {
    return error(c, "TENANT_NOT_FOUND", "Tenant not found.", 404);
  }

  return success(c, {
    tenant: {
      id: tenant.id,
      appId: tenant.appId,
      tenantKey: tenant.tenantKey,
      name: tenant.name,
      tenantType: tenant.tenantType,
      status: tenant.status,
      ownerUserId: tenant.ownerUserId,
      domain: tenant.domain,
      metadata: tenant.metadata,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    },
  });
});

export default internalAppRoutes;
