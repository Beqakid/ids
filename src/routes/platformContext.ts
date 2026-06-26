/**
 * Platform Context Routes — Phase 6
 *
 * Mounted at /api/platform
 * All routes are protected by Phase 5 auth.
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { requireServiceAuth, requireUserAuth, optionalAuth } from "../middleware/auth";
import { success, error } from "../lib/response";
import { parseLimitOffset, requireString } from "../lib/validation";
import {
  getUserPlatformSummary,
  getUserAppContext,
  listAccessibleAppsForUser,
  listAccessibleTenantsForUser,
} from "../services/platformContext";

const platformContextRoutes = new Hono<HonoEnv>();

// ── GET /api/platform/me ──────────────────────────────────────
// Returns the authenticated user's safe platform summary.
// Requires Bearer JWT (user auth).

platformContextRoutes.get("/me", requireUserAuth(), async (c) => {
  const authCtx = c.get("authContext")!;
  const userId = authCtx.userId!;

  const result = await getUserPlatformSummary(
    {
      userId,
      requesterType: "service",
      requesterClientId: null,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
    c.env
  );

  if (!result.ok) {
    return error(c, "NOT_FOUND", result.error, 404);
  }

  return success(c, result.data);
});

// ── GET /api/platform/users/:id/summary ──────────────────────
// Returns a safe platform summary for any user.
// Requires service API key or authorized Bearer token.

platformContextRoutes.get(
  "/users/:id/summary",
  requireServiceAuth(),
  async (c) => {
    const userId = c.req.param("id");
    const authCtx = c.get("authContext")!;

    const result = await getUserPlatformSummary(
      {
        userId,
        requesterType:
          authCtx.principalType === "service" ? "service" : "internal",
        requesterClientId:
          authCtx.principalType === "service" ? (authCtx.clientId ?? null) : null,
        ipAddress: c.req.header("CF-Connecting-IP") ?? null,
        userAgent: c.req.header("user-agent") ?? null,
      },
      c.env
    );

    if (!result.ok) {
      return error(c, "NOT_FOUND", result.error, 404);
    }

    return success(c, result.data);
  }
);

// ── GET /api/platform/users/:id/apps ─────────────────────────
// Returns apps the user can access.
// Requires service auth or authorized Bearer.

platformContextRoutes.get(
  "/users/:id/apps",
  requireServiceAuth(),
  async (c) => {
    const userId = c.req.param("id");
    const apps = await listAccessibleAppsForUser(c.env, userId);
    return success(c, { apps, total: apps.length });
  }
);

// ── GET /api/platform/users/:id/tenants ──────────────────────
// Returns tenants/workspaces the user can access.
// Optional query: appId
// Requires service auth.

platformContextRoutes.get(
  "/users/:id/tenants",
  requireServiceAuth(),
  async (c) => {
    const userId = c.req.param("id");
    const appId = c.req.query("appId") ?? null;
    const tenants = await listAccessibleTenantsForUser(c.env, userId, appId);
    return success(c, { tenants, total: tenants.length });
  }
);

// ── GET /api/platform/context ─────────────────────────────────
// Returns full user + app + tenant + membership + roles + permissions + trust signals.
// Query: userId (required), appId (required), tenantId (optional)
// Requires service auth or authorized Bearer.

platformContextRoutes.get("/context", requireServiceAuth(), async (c) => {
  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const tenantId = c.req.query("tenantId") ?? null;

  if (!userId || !appId) {
    return error(
      c,
      "VALIDATION_ERROR",
      "userId and appId query parameters are required.",
      400
    );
  }

  const authCtx = c.get("authContext")!;

  const result = await getUserAppContext(
    {
      userId,
      appId,
      tenantId,
      requesterType:
        authCtx.principalType === "service" ? "service" : "internal",
      requesterClientId:
        authCtx.principalType === "service" ? (authCtx.clientId ?? null) : null,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
    c.env
  );

  if (!result.ok) {
    return error(c, "NOT_FOUND", result.error, 404);
  }

  return success(c, result.data);
});

export default platformContextRoutes;
