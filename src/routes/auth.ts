/**
 * Auth routes — Phase 5
 * Mounted at /api/auth
 *
 * POST /api/auth/token/exchange  — exchange valid IDS session for access JWT
 * POST /api/auth/token/verify    — verify an access JWT
 * POST /api/auth/token/revoke    — revoke current JWT by jti (requires Bearer)
 * GET  /api/auth/context         — return safe auth context (requires Bearer)
 */

import { Hono } from "hono";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { requireString, optionalString, ValidationError } from "../lib/validation";
import { requireUserAuth } from "../middleware/auth";
import {
  exchangeSessionForAccessToken,
  verifyAccessToken,
  revokeTokenByJti,
  writeTokenEvent,
} from "../services/tokens";
import { writeAuditLog } from "../services/audit";
import { getUserById } from "../services/users";
import { getAppByIdSilent } from "../services/apps";
import { getDB } from "../lib/db";

const authRoutes = new Hono<HonoEnv>();

// ── POST /api/auth/token/exchange ─────────────────────────────
// Public — requires a valid raw session token in the request body.

authRoutes.post("/token/exchange", async (c) => {
  try {
    const body = await c.req.json();

    const sessionToken = requireString(body.sessionToken, "sessionToken");
    const appId = requireString(body.appId, "appId");
    const tenantId = optionalString(body.tenantId) ?? null;
    const ttlSeconds =
      typeof body.ttlSeconds === "number" ? Math.min(body.ttlSeconds, 3600) : 900;

    const ipAddress =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      null;
    const userAgent = c.req.header("User-Agent") ?? null;

    const result = await exchangeSessionForAccessToken(c.env, {
      sessionToken,
      appId,
      tenantId,
      ttlSeconds,
      ipAddress,
      userAgent,
    });

    if (!result.ok) {
      const statusMap: Record<string, 400 | 401 | 403 | 404 | 500> = {
        INVALID_SESSION_TOKEN: 401,
        SESSION_NOT_ACTIVE: 401,
        SESSION_EXPIRED: 401,
        USER_NOT_FOUND: 401,
        USER_NOT_ACTIVE: 403,
        APP_NOT_FOUND: 400,
        APP_NOT_ACTIVE: 403,
        TENANT_NOT_FOUND: 400,
        TENANT_NOT_ACTIVE: 403,
        NO_ACTIVE_MEMBERSHIP: 403,
        JWT_NOT_CONFIGURED: 500,
      };
      const status = statusMap[result.code] ?? 400;
      return error(c, result.code, result.message, status);
    }

    // Fetch user and app details for the response
    const user = await getUserById(c.env, result.userId);
    const app = await getAppByIdSilent(c.env, result.appId);

    // Fetch tenant details if present
    let tenantData: { id: string; status: string } | null = null;
    if (result.tenantId) {
      const db = getDB(c.env);
      tenantData = await db
        .prepare("SELECT id, status FROM ids_tenants WHERE id = ?")
        .bind(result.tenantId)
        .first<{ id: string; status: string }>() ?? null;
    }

    return success(c, {
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
      expiresAt: result.expiresAt,
      user: user
        ? {
            id: user.id,
            displayName: user.displayName,
            status: user.status,
          }
        : { id: result.userId, displayName: null, status: "active" },
      app: app
        ? { appId: app.appId, status: app.status }
        : { appId: result.appId, status: "active" },
      tenant: tenantData
        ? { id: tenantData.id, status: tenantData.status }
        : null,
      roles: result.roles,
      permissions: result.permissions,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/auth/token/verify ───────────────────────────────
// Public — verifies a JWT without requiring caller auth.

authRoutes.post("/token/verify", async (c) => {
  try {
    const body = await c.req.json();
    const accessToken = requireString(body.accessToken, "accessToken");

    const ipAddress =
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For") ??
      null;
    const userAgent = c.req.header("User-Agent") ?? null;

    const result = await verifyAccessToken(c.env, accessToken, {
      ipAddress,
      userAgent,
    });

    if (!result.ok) {
      return success(c, { valid: false, reason: result.code });
    }

    return success(c, {
      valid: true,
      userId: result.userId,
      sessionId: result.sessionId,
      appId: result.appId,
      tenantId: result.tenantId,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/auth/token/revoke ───────────────────────────────
// Requires: Bearer token. Revokes the current JWT.

authRoutes.post("/token/revoke", requireUserAuth(), async (c) => {
  const authCtx = c.get("authContext")!;

  if (!authCtx.jti || !authCtx.userId) {
    return error(c, "INVALID_TOKEN", "Cannot revoke — token claims are incomplete.", 400);
  }

  // We need the exp from the token to store revocation expiry
  // Decode without verification (already verified by middleware)
  const authHeader = c.req.header("Authorization") ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  let expiresAt = new Date(Date.now() + 3600 * 1000).toISOString(); // fallback 1 hr
  if (rawToken) {
    const { decodeJwtUnsafe } = await import("../lib/jwt");
    const payload = decodeJwtUnsafe(rawToken);
    if (payload?.exp) {
      expiresAt = new Date(payload.exp * 1000).toISOString();
    }
  }

  await revokeTokenByJti(c.env, {
    jti: authCtx.jti,
    expiresAt,
    userId: authCtx.userId,
    sessionId: authCtx.sessionId,
    appId: authCtx.appId,
    tenantId: authCtx.tenantId,
    reason: "user_requested",
  });

  await writeTokenEvent(c.env, {
    tokenType: "access",
    eventType: "token_revoked",
    userId: authCtx.userId,
    sessionId: authCtx.sessionId,
    appId: authCtx.appId,
    tenantId: authCtx.tenantId,
    jti: authCtx.jti,
    success: true,
    reason: "user_requested",
  });

  await writeAuditLog(c.env, {
    eventType: "token_revoked",
    userId: authCtx.userId,
    appId: authCtx.appId,
    tenantId: authCtx.tenantId,
    metadata: { jti: authCtx.jti },
  });

  return success(c, { revoked: true });
});

// ── GET /api/auth/context ─────────────────────────────────────
// Requires: Bearer token. Returns safe auth context.

authRoutes.get("/context", requireUserAuth(), async (c) => {
  const authCtx = c.get("authContext")!;

  // Fetch user
  const user = authCtx.userId
    ? await getUserById(c.env, authCtx.userId)
    : null;

  // Fetch app
  const app = authCtx.appId
    ? await getAppByIdSilent(c.env, authCtx.appId)
    : null;

  // Fetch session
  let session: { id: string; status: string; expiresAt: string } | null = null;
  if (authCtx.sessionId) {
    const db = getDB(c.env);
    const row = await db
      .prepare("SELECT id, status, expires_at FROM ids_sessions WHERE id = ?")
      .bind(authCtx.sessionId)
      .first<{ id: string; status: string; expires_at: string }>();
    if (row) {
      session = { id: row.id, status: row.status, expiresAt: row.expires_at };
    }
  }

  // Fetch tenant
  let tenant: { id: string; status: string } | null = null;
  if (authCtx.tenantId) {
    const db = getDB(c.env);
    const row = await db
      .prepare("SELECT id, status FROM ids_tenants WHERE id = ?")
      .bind(authCtx.tenantId)
      .first<{ id: string; status: string }>();
    tenant = row ?? null;
  }

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
    session,
    app: app ? { appId: app.appId, name: app.name, status: app.status } : null,
    tenant,
    // TODO: Phase 6 — include effective roles/permissions from Phase 4 checks.
    roles: authCtx.roles ?? [],
    permissions: authCtx.permissions ?? [],
  });
});

export default authRoutes;
