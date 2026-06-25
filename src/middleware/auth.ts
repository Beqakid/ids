/**
 * Auth middleware — Phase 5
 *
 * Supported auth methods:
 *   A. Bearer IDS JWT:       Authorization: Bearer <accessToken>
 *   B. Service API Key:      x-ids-service-key: <rawServiceApiKey>
 *   C. Bootstrap Key:        x-ids-bootstrap-key: <IDS_BOOTSTRAP_API_KEY>
 *      (Bootstrap key only accepted on bootstrap routes.)
 *
 * TODO: Phase 5 — add rate limiting / abuse protection on auth failures.
 */

import { createMiddleware } from "hono/factory";
import type { HonoEnv } from "../types/env";
import type { AuthContext } from "../types/auth";
import { error } from "../lib/response";
import { verifyJwt, JwtError, decodeJwtUnsafe } from "../lib/jwt";
import { isTokenRevoked } from "../services/tokens";
import { verifyServiceApiKeyForAuth } from "../services/serviceClients";
import { getDB } from "../lib/db";

// ── Get auth context (non-throwing) ──────────────────────────

export async function getAuthContext(
  request: Request,
  env: import("../types/env").Env
): Promise<AuthContext> {
  const authHeader = request.headers.get("Authorization");
  const serviceKey = request.headers.get("x-ids-service-key");

  // ── A. Bearer JWT ────────────────────────────────────────
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (!env.IDS_JWT_SECRET) {
      return {
        principalType: "anonymous",
        authenticated: false,
        reason: "JWT_NOT_CONFIGURED",
      };
    }

    try {
      const { payload } = await verifyJwt(token, env.IDS_JWT_SECRET, {
        issuer: "ids",
      });

      const jti = payload.jti as string | undefined;
      const userId = payload.sub as string | undefined;
      const sessionId = payload.sid as string | undefined;
      const appId = payload.app_id as string | undefined;
      const tenantId =
        (payload.tenant_id as string | null | undefined) ?? null;

      // Check revocation
      if (jti && (await isTokenRevoked(env, jti))) {
        return {
          principalType: "anonymous",
          authenticated: false,
          reason: "TOKEN_REVOKED",
        };
      }

      // Verify session still active
      if (sessionId) {
        const db = getDB(env);
        const sessionRow = await db
          .prepare(
            "SELECT status, expires_at FROM ids_sessions WHERE id = ?"
          )
          .bind(sessionId)
          .first<{ status: string; expires_at: string }>();

        if (
          !sessionRow ||
          sessionRow.status !== "active" ||
          new Date(sessionRow.expires_at) < new Date()
        ) {
          return {
            principalType: "anonymous",
            authenticated: false,
            reason: "SESSION_REVOKED",
          };
        }
      }

      return {
        principalType: "user",
        authenticated: true,
        userId,
        sessionId,
        appId,
        tenantId,
        jti,
        tokenType: payload.typ as string | undefined,
        roles: payload.roles as string[] | undefined,
        permissions: payload.permissions as string[] | undefined,
      };
    } catch (err) {
      const code = err instanceof JwtError ? err.code : "INVALID_TOKEN";
      return {
        principalType: "anonymous",
        authenticated: false,
        reason: code,
      };
    }
  }

  // ── B. Service API key ───────────────────────────────────
  if (serviceKey) {
    const result = await verifyServiceApiKeyForAuth(env, serviceKey);
    if (result.ok && result.serviceClient) {
      return {
        principalType: "service",
        authenticated: true,
        serviceClientId: result.serviceClient.id,
        clientId: result.serviceClient.clientId,
        appId: result.serviceClient.appId ?? undefined,
        tenantId: result.serviceClient.tenantId ?? null,
      };
    }
    return {
      principalType: "anonymous",
      authenticated: false,
      reason: result.reason ?? "INVALID_SERVICE_KEY",
    };
  }

  return {
    principalType: "anonymous",
    authenticated: false,
  };
}

// ── requireServiceAuth ────────────────────────────────────────
// Accepts: valid IDS JWT (user) OR valid service API key (service)
// Returns 401 if neither is present or valid.

export const requireServiceAuth = () =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const authCtx = await getAuthContext(c.req.raw, c.env);
    if (
      !authCtx.authenticated ||
      (authCtx.principalType !== "user" &&
        authCtx.principalType !== "service")
    ) {
      return error(
        c,
        "AUTH_REQUIRED",
        "Authentication is required.",
        401
      );
    }
    c.set("authContext", authCtx);
    await next();
  });

// ── requireBootstrapAuth ──────────────────────────────────────
// Accepts ONLY the bootstrap key (x-ids-bootstrap-key header).
// Only for the bootstrap route.

export const requireBootstrapAuth = () =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const bootstrapKey = c.req.header("x-ids-bootstrap-key");

    if (!bootstrapKey) {
      return error(
        c,
        "AUTH_REQUIRED",
        "Bootstrap key is required.",
        401
      );
    }

    if (!c.env.IDS_BOOTSTRAP_API_KEY) {
      return error(
        c,
        "JWT_NOT_CONFIGURED",
        "Token service is not configured.",
        500
      );
    }

    // Constant-time comparison to prevent timing attacks
    if (bootstrapKey !== c.env.IDS_BOOTSTRAP_API_KEY) {
      return error(
        c,
        "INVALID_BOOTSTRAP_KEY",
        "The bootstrap key is invalid.",
        401
      );
    }

    c.set("authContext", {
      principalType: "bootstrap",
      authenticated: true,
    });
    await next();
  });

// ── optionalAuth ──────────────────────────────────────────────
// Sets authContext if a valid credential is present; does NOT block unauthenticated.

export const optionalAuth = () =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const authCtx = await getAuthContext(c.req.raw, c.env);
    c.set("authContext", authCtx);
    await next();
  });

// ── requireUserAuth ───────────────────────────────────────────
// Requires a valid IDS JWT (user principal only).

export const requireUserAuth = () =>
  createMiddleware<HonoEnv>(async (c, next) => {
    const authCtx = await getAuthContext(c.req.raw, c.env);
    if (!authCtx.authenticated || authCtx.principalType !== "user") {
      return error(
        c,
        "AUTH_REQUIRED",
        "A valid user access token is required.",
        401
      );
    }
    c.set("authContext", authCtx);
    await next();
  });
