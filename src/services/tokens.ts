/**
 * Token service — Phase 5
 * Handles JWT issuing, session-to-token exchange, token verification,
 * token revocation, and token event logging.
 */

import type { Env } from "../types/env";
import type { TokenType, TokenEventType, IdsTokenEventRow } from "../types/tokens";
import { getDB } from "../lib/db";
import { signJwt, verifyJwt, createJti, getUnixTime, JwtError } from "../lib/jwt";
import { hashSessionToken, isSessionExpired } from "./sessions";
import { writeAuditLog } from "./audit";

// ── Token event helpers ───────────────────────────────────────

export interface WriteTokenEventInput {
  userId?: string | null;
  sessionId?: string | null;
  appId?: string | null;
  tenantId?: string | null;
  tokenType: TokenType;
  eventType: TokenEventType;
  jti?: string | null;
  subject?: string | null;
  audience?: string | null;
  success: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeTokenEvent(
  env: Env,
  input: WriteTokenEventInput
): Promise<string> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_token_events
         (id, user_id, session_id, app_id, tenant_id, token_type, event_type,
          jti, subject, audience, success, reason, ip_address, user_agent,
          metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId ?? null,
      input.sessionId ?? null,
      input.appId ?? null,
      input.tenantId ?? null,
      input.tokenType,
      input.eventType,
      input.jti ?? null,
      input.subject ?? null,
      input.audience ?? null,
      input.success ? 1 : 0,
      input.reason ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    )
    .run();

  return id;
}

// ── Revoked token check ───────────────────────────────────────

export async function isTokenRevoked(env: Env, jti: string): Promise<boolean> {
  const db = getDB(env);
  const row = await db
    .prepare(
      "SELECT id FROM ids_revoked_tokens WHERE jti = ? AND expires_at > datetime('now')"
    )
    .bind(jti)
    .first();
  return !!row;
}

// ── Revoke token by JTI ───────────────────────────────────────

export interface RevokeTokenInput {
  jti: string;
  expiresAt: string;
  userId?: string | null;
  sessionId?: string | null;
  appId?: string | null;
  tenantId?: string | null;
  reason?: string | null;
}

export async function revokeTokenByJti(
  env: Env,
  input: RevokeTokenInput
): Promise<void> {
  const db = getDB(env);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT OR IGNORE INTO ids_revoked_tokens
         (id, jti, user_id, session_id, app_id, tenant_id, reason,
          revoked_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.jti,
      input.userId ?? null,
      input.sessionId ?? null,
      input.appId ?? null,
      input.tenantId ?? null,
      input.reason ?? null,
      now,
      input.expiresAt,
      now
    )
    .run();
}

// ── Exchange session for access token ────────────────────────

export interface ExchangeSessionInput {
  sessionToken: string;
  appId: string;
  tenantId?: string | null;
  ttlSeconds?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type ExchangeSessionResult =
  | {
      ok: true;
      accessToken: string;
      tokenType: "Bearer";
      expiresIn: number;
      expiresAt: string;
      jti: string;
      userId: string;
      sessionId: string;
      appId: string;
      tenantId: string | null;
      roles: string[];
      permissions: string[];
    }
  | { ok: false; code: string; message: string };

export async function exchangeSessionForAccessToken(
  env: Env,
  input: ExchangeSessionInput
): Promise<ExchangeSessionResult> {
  const db = getDB(env);
  const fail = async (
    code: string,
    message: string,
    extra: Partial<WriteTokenEventInput> = {}
  ): Promise<ExchangeSessionResult> => {
    await writeTokenEvent(env, {
      tokenType: "access",
      eventType: "token_exchange_failed",
      appId: input.appId,
      tenantId: input.tenantId,
      success: false,
      reason: code,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      ...extra,
    });
    return { ok: false, code, message };
  };

  // Log the attempt
  await writeTokenEvent(env, {
    tokenType: "access",
    eventType: "token_exchange_attempt",
    appId: input.appId,
    tenantId: input.tenantId,
    success: false,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  // ── 1. Check JWT secret is configured ──────────────────────
  if (!env.IDS_JWT_SECRET) {
    return fail("JWT_NOT_CONFIGURED", "Token service is not configured.");
  }

  // ── 2. Hash the session token and look up session ───────────
  const tokenHash = await hashSessionToken(input.sessionToken);
  const sessionRow = await db
    .prepare("SELECT * FROM ids_sessions WHERE session_token_hash = ?")
    .bind(tokenHash)
    .first<{
      id: string;
      user_id: string;
      status: string;
      app_id: string | null;
      expires_at: string;
      revoked_at: string | null;
    }>();

  if (!sessionRow) {
    return fail("INVALID_SESSION_TOKEN", "Session token is invalid.");
  }

  const sessionId = sessionRow.id;

  if (sessionRow.status !== "active") {
    return fail("SESSION_NOT_ACTIVE", "Session is not active.", { sessionId });
  }

  if (new Date(sessionRow.expires_at) < new Date()) {
    return fail("SESSION_EXPIRED", "Session has expired.", { sessionId });
  }

  // ── 3. Verify user ──────────────────────────────────────────
  const userId = sessionRow.user_id;
  const userRow = await db
    .prepare("SELECT id, status FROM ids_users WHERE id = ?")
    .bind(userId)
    .first<{ id: string; status: string }>();

  if (!userRow) {
    return fail("USER_NOT_FOUND", "User not found.", { sessionId, userId });
  }

  if (
    userRow.status === "suspended" ||
    userRow.status === "blocked" ||
    userRow.status === "deleted"
  ) {
    return fail("USER_NOT_ACTIVE", `User account is ${userRow.status}.`, {
      sessionId,
      userId,
    });
  }

  // ── 4. Verify app ───────────────────────────────────────────
  const appRow = await db
    .prepare("SELECT app_id, status FROM ids_apps WHERE app_id = ?")
    .bind(input.appId)
    .first<{ app_id: string; status: string }>();

  if (!appRow) {
    return fail("APP_NOT_FOUND", "App not found.", { sessionId, userId });
  }

  if (
    appRow.status === "suspended" ||
    appRow.status === "deprecated" ||
    appRow.status === "archived"
  ) {
    return fail("APP_NOT_ACTIVE", `App is ${appRow.status}.`, { sessionId, userId });
  }

  // ── 5. Verify tenant (if provided) ─────────────────────────
  let resolvedTenantId: string | null = null;
  if (input.tenantId) {
    const tenantRow = await db
      .prepare("SELECT id, status FROM ids_tenants WHERE id = ?")
      .bind(input.tenantId)
      .first<{ id: string; status: string }>();

    if (!tenantRow) {
      return fail("TENANT_NOT_FOUND", "Tenant not found.", { sessionId, userId });
    }

    if (
      tenantRow.status === "suspended" ||
      tenantRow.status === "archived" ||
      tenantRow.status === "deleted"
    ) {
      return fail("TENANT_NOT_ACTIVE", `Tenant is ${tenantRow.status}.`, {
        sessionId,
        userId,
      });
    }

    // Verify active membership if tenant context provided
    const membershipRow = await db
      .prepare(
        "SELECT id FROM ids_memberships WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1"
      )
      .bind(userId, input.tenantId)
      .first();

    if (!membershipRow) {
      return fail(
        "NO_ACTIVE_MEMBERSHIP",
        "User has no active membership in this tenant.",
        { sessionId, userId }
      );
    }

    resolvedTenantId = input.tenantId;
  }

  // ── 6. Collect roles/permissions (Phase 4 wiring) ──────────
  // TODO: Phase 6 — wire to effective permissions service for role/permission claims.
  // For now, roles and permissions are empty arrays in the token payload.
  const roles: string[] = [];
  const permissions: string[] = [];

  // ── 7. Issue the JWT ────────────────────────────────────────
  const jti = createJti();
  const ttlSeconds = Math.min(input.ttlSeconds ?? 900, 3600);
  const nowUnix = getUnixTime();
  const expiresAtDate = new Date((nowUnix + ttlSeconds) * 1000).toISOString();

  const token = await signJwt(
    {
      iss: "ids",
      sub: userId,
      aud: input.appId,
      sid: sessionId,
      app_id: input.appId,
      tenant_id: resolvedTenantId,
      roles,
      permissions,
      jti,
      typ: "access",
    },
    env.IDS_JWT_SECRET,
    { expiresIn: ttlSeconds }
  );

  // ── 8. Log success events ───────────────────────────────────
  await writeTokenEvent(env, {
    tokenType: "access",
    eventType: "token_issued",
    userId,
    sessionId,
    appId: input.appId,
    tenantId: resolvedTenantId,
    jti,
    subject: userId,
    audience: input.appId,
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await writeAuditLog(env, {
    eventType: "token_issued",
    userId,
    appId: input.appId,
    tenantId: resolvedTenantId,
    metadata: { sessionId, jti, tokenType: "access", ttlSeconds },
  });

  return {
    ok: true,
    accessToken: token,
    tokenType: "Bearer",
    expiresIn: ttlSeconds,
    expiresAt: expiresAtDate,
    jti,
    userId,
    sessionId,
    appId: input.appId,
    tenantId: resolvedTenantId,
    roles,
    permissions,
  };
}

// ── Verify access token ───────────────────────────────────────

export type VerifyTokenResult =
  | {
      ok: true;
      userId: string;
      sessionId: string;
      appId: string;
      tenantId: string | null;
      jti: string;
      expiresAt: string;
    }
  | { ok: false; code: string; message: string };

export async function verifyAccessToken(
  env: Env,
  token: string,
  opts: { ipAddress?: string | null; userAgent?: string | null } = {}
): Promise<VerifyTokenResult> {
  const db = getDB(env);

  const failVerify = async (
    code: string,
    message: string,
    meta: Partial<WriteTokenEventInput> = {}
  ): Promise<VerifyTokenResult> => {
    await writeTokenEvent(env, {
      tokenType: "access",
      eventType: "token_verify_failed",
      success: false,
      reason: code,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
      ...meta,
    });
    return { ok: false, code, message };
  };

  if (!env.IDS_JWT_SECRET) {
    return failVerify("JWT_NOT_CONFIGURED", "Token service is not configured.");
  }

  // ── Verify signature and claims ────────────────────────────
  let payload: import("../lib/jwt").JwtPayload;
  try {
    const verified = await verifyJwt(token, env.IDS_JWT_SECRET, {
      issuer: "ids",
    });
    payload = verified.payload;
  } catch (err) {
    const code = err instanceof JwtError ? err.code : "INVALID_TOKEN";
    return failVerify(code, "The access token is invalid or expired.");
  }

  const jti = payload.jti as string;
  const userId = payload.sub as string;
  const sessionId = payload.sid as string;
  const appId = payload.app_id as string;
  const tenantId = (payload.tenant_id as string | null) ?? null;
  const exp = payload.exp as number;
  const expiresAt = new Date(exp * 1000).toISOString();

  // ── Check revocation ────────────────────────────────────────
  if (jti && (await isTokenRevoked(env, jti))) {
    return failVerify("TOKEN_REVOKED", "Token has been revoked.", {
      jti,
      userId,
      sessionId,
      appId,
      tenantId,
    });
  }

  // ── Verify session still active ─────────────────────────────
  const sessionRow = await db
    .prepare(
      "SELECT status, expires_at FROM ids_sessions WHERE id = ?"
    )
    .bind(sessionId)
    .first<{ status: string; expires_at: string }>();

  if (!sessionRow || sessionRow.status !== "active") {
    return failVerify(
      "SESSION_REVOKED",
      "The session associated with this token is no longer active.",
      { jti, userId, sessionId, appId }
    );
  }

  if (new Date(sessionRow.expires_at) < new Date()) {
    return failVerify("SESSION_EXPIRED", "The session has expired.", {
      jti,
      userId,
      sessionId,
      appId,
    });
  }

  // ── Verify user still active ────────────────────────────────
  const userRow = await db
    .prepare("SELECT status FROM ids_users WHERE id = ?")
    .bind(userId)
    .first<{ status: string }>();

  if (
    !userRow ||
    userRow.status === "suspended" ||
    userRow.status === "blocked" ||
    userRow.status === "deleted"
  ) {
    return failVerify("USER_NOT_ACTIVE", "User account is not active.", {
      jti,
      userId,
      sessionId,
      appId,
    });
  }

  // ── Verify app still active ─────────────────────────────────
  const appRow = await db
    .prepare("SELECT status FROM ids_apps WHERE app_id = ?")
    .bind(appId)
    .first<{ status: string }>();

  if (
    !appRow ||
    appRow.status === "suspended" ||
    appRow.status === "deprecated" ||
    appRow.status === "archived"
  ) {
    return failVerify("APP_NOT_ACTIVE", "App is not active.", {
      jti,
      userId,
      sessionId,
      appId,
    });
  }

  // ── Verify tenant still active (if in token) ────────────────
  if (tenantId) {
    const tenantRow = await db
      .prepare("SELECT status FROM ids_tenants WHERE id = ?")
      .bind(tenantId)
      .first<{ status: string }>();

    if (
      !tenantRow ||
      tenantRow.status === "suspended" ||
      tenantRow.status === "archived" ||
      tenantRow.status === "deleted"
    ) {
      return failVerify("TENANT_NOT_ACTIVE", "Tenant is not active.", {
        jti,
        userId,
        sessionId,
        appId,
        tenantId,
      });
    }
  }

  // ── Log success ─────────────────────────────────────────────
  await writeTokenEvent(env, {
    tokenType: "access",
    eventType: "token_verified",
    userId,
    sessionId,
    appId,
    tenantId,
    jti,
    success: true,
    ipAddress: opts.ipAddress,
    userAgent: opts.userAgent,
  });

  return { ok: true, userId, sessionId, appId, tenantId, jti, expiresAt };
}

// ── List token events ─────────────────────────────────────────

export interface ListTokenEventsOptions {
  userId?: string;
  sessionId?: string;
  appId?: string;
  eventType?: string;
  jti?: string;
  limit?: number;
  offset?: number;
}

export async function listTokenEvents(
  env: Env,
  opts: ListTokenEventsOptions = {}
) {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) {
    conditions.push("user_id = ?");
    params.push(opts.userId);
  }
  if (opts.sessionId) {
    conditions.push("session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts.appId) {
    conditions.push("app_id = ?");
    params.push(opts.appId);
  }
  if (opts.eventType) {
    conditions.push("event_type = ?");
    params.push(opts.eventType);
  }
  if (opts.jti) {
    conditions.push("jti = ?");
    params.push(opts.jti);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_token_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all<IdsTokenEventRow>();

  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM ids_token_events ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  return {
    events: (rows.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      appId: row.app_id,
      tenantId: row.tenant_id,
      tokenType: row.token_type,
      eventType: row.event_type,
      jti: row.jti,
      subject: row.subject,
      audience: row.audience,
      success: row.success === 1,
      reason: row.reason,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      // metadata intentionally omitted from list (may contain sensitive keys)
    })),
    total: countRow?.total ?? 0,
    limit,
    offset,
  };
}
