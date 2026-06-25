import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success } from "../lib/response";
import { optionalAuth } from "../middleware/auth";
import { getUserById } from "../services/users";

const users = new Hono<HonoEnv>();

/**
 * GET /api/users/me
 * Phase 5: uses optional auth.
 * - Returns authenticated: false when no token is present.
 * - Returns safe user context when a valid IDS access token is supplied.
 * - Never fakes a login.
 */
users.get("/users/me", optionalAuth(), async (c) => {
  const authCtx = c.get("authContext");

  if (!authCtx?.authenticated || !authCtx.userId) {
    return success(c, {
      authenticated: false,
    });
  }

  const user = await getUserById(c.env, authCtx.userId);

  return success(c, {
    authenticated: true,
    principalType: authCtx.principalType,
    user: user
      ? {
          id: user.id,
          displayName: user.displayName,
          status: user.status,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
        }
      : null,
    appId: authCtx.appId ?? null,
    tenantId: authCtx.tenantId ?? null,
    // TODO: Phase 6 — include roles/permissions from token claims.
    roles: authCtx.roles ?? [],
    permissions: authCtx.permissions ?? [],
  });
});

export default users;
