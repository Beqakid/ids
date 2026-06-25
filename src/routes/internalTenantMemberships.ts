import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { getTenantByKey } from "../services/tenants";
import { listMembershipsForTenant } from "../services/memberships";
import { listMembershipsForApp } from "../services/memberships";
import { getTenantByIdSilent } from "../services/tenants";

const internalTenantMemberships = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalTenantMemberships.use("*", requireServiceAuth());

/**
 * GET /api/internal/tenants/:id/memberships
 * List memberships for a specific tenant.
 */
internalTenantMemberships.get("/:id/memberships", async (c) => {
  const tenantId = c.req.param("id");
  const tenant = await getTenantByIdSilent(c.env, tenantId);
  if (!tenant) {
    return error(c, "TENANT_NOT_FOUND", "Tenant not found.", 404);
  }

  const memberships = await listMembershipsForTenant(c.env, tenantId);

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

export default internalTenantMemberships;
