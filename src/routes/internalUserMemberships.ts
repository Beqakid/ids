import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { getUserById } from "../services/users";
import { listMembershipsForUser } from "../services/memberships";

const internalUserMemberships = new Hono<HonoEnv>();

/**
 * GET /api/internal/users/:id/memberships
 * List memberships for a specific user.
 */
internalUserMemberships.get("/:id/memberships", async (c) => {
  const userId = c.req.param("id");
  const user = await getUserById(c.env, userId);
  if (!user) {
    return error(c, "USER_NOT_FOUND", "User not found.", 404);
  }

  const memberships = await listMembershipsForUser(c.env, userId);

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

export default internalUserMemberships;
