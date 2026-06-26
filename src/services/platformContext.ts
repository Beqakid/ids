/**
 * Platform Context Service — Phase 6
 *
 * Provides safe, permission-aware context packages for Command Center and Kai.
 * Never exposes: session_token_hash, service key hashes, Twilio secrets, OTP codes,
 * raw JWT claims, stack traces, or any internal secret values.
 *
 * TODO: Phase 5 internal routes must be protected with service auth (done).
 * TODO: Phase 7 — extend trust signals with TrustProof receipt data.
 */

import type { Env } from "../types/env";
import type {
  UserPlatformSummary,
  UserAppContext,
  UserAppAccessEntry,
  UserTenantAccessEntry,
  TrustSignals,
  WritePlatformContextRequestInput,
  IdsPlatformContextRequest,
  IdsPlatformContextRequestRow,
  SafeUserSummary,
} from "../types/platformContext";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getUserById } from "./users";
import { getAppByIdSilent } from "./apps";
import { getTenantByIdSilent } from "./tenants";
import {
  getRoleKeysForUserContext,
  getPermissionsForUserContext,
} from "./permissionChecks";

// ── Helper: parse stored JSON safely ─────────────────────────

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToContextRequest(
  row: IdsPlatformContextRequestRow
): IdsPlatformContextRequest {
  return {
    id: row.id,
    requesterType: row.requester_type as IdsPlatformContextRequest["requesterType"],
    requesterClientId: row.requester_client_id,
    requesterAppId: row.requester_app_id,
    userId: row.user_id,
    targetAppId: row.target_app_id,
    targetTenantId: row.target_tenant_id,
    contextType: row.context_type as IdsPlatformContextRequest["contextType"],
    success: row.success === 1,
    reason: row.reason,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: parseJson(row.metadata),
    createdAt: row.created_at,
  };
}

// ── Write platform context request log ────────────────────────

export async function writePlatformContextRequest(
  env: Env,
  input: WritePlatformContextRequestInput
): Promise<string> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_platform_context_requests
         (id, requester_type, requester_client_id, requester_app_id,
          user_id, target_app_id, target_tenant_id, context_type,
          success, reason, ip_address, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.requesterType,
      input.requesterClientId ?? null,
      input.requesterAppId ?? null,
      input.userId ?? null,
      input.targetAppId ?? null,
      input.targetTenantId ?? null,
      input.contextType,
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

// ── Build trust signals for a user ───────────────────────────

export async function buildTrustSignalsForUser(
  env: Env,
  userId: string
): Promise<TrustSignals> {
  const db = getDB(env);

  const user = await getUserById(env, userId);
  if (!user) {
    return {
      emailVerified: false,
      phoneVerified: false,
      activeSessions: 0,
      hasActiveMemberships: false,
    };
  }

  const sessionCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM ids_sessions
       WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')`
    )
    .bind(userId)
    .first<{ cnt: number }>();

  const membershipCount = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM ids_memberships
       WHERE user_id = ? AND status = 'active'`
    )
    .bind(userId)
    .first<{ cnt: number }>();

  return {
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    activeSessions: sessionCount?.cnt ?? 0,
    hasActiveMemberships: (membershipCount?.cnt ?? 0) > 0,
  };
}

// ── List accessible apps for user ─────────────────────────────

export async function listAccessibleAppsForUser(
  env: Env,
  userId: string
): Promise<UserAppAccessEntry[]> {
  const db = getDB(env);

  // Get all active memberships for this user, joined with app info
  const rows = await db
    .prepare(
      `SELECT m.app_id, m.role_key, m.tenant_id, a.name, a.status
       FROM ids_memberships m
       JOIN ids_apps a ON a.app_id = m.app_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY m.app_id, m.role_key`
    )
    .bind(userId)
    .all<{
      app_id: string;
      role_key: string;
      tenant_id: string;
      name: string;
      status: string;
    }>();

  // Aggregate by app_id
  const appMap = new Map<
    string,
    { name: string; status: string; roles: Set<string>; tenants: Set<string> }
  >();

  for (const row of rows.results ?? []) {
    if (!appMap.has(row.app_id)) {
      appMap.set(row.app_id, {
        name: row.name,
        status: row.status,
        roles: new Set(),
        tenants: new Set(),
      });
    }
    const entry = appMap.get(row.app_id)!;
    entry.roles.add(row.role_key);
    if (row.tenant_id) entry.tenants.add(row.tenant_id);
  }

  const result: UserAppAccessEntry[] = [];
  for (const [appId, entry] of appMap.entries()) {
    result.push({
      appId,
      name: entry.name,
      status: entry.status,
      roles: Array.from(entry.roles),
      tenantCount: entry.tenants.size,
    });
  }

  return result;
}

// ── List accessible tenants for user ──────────────────────────

export async function listAccessibleTenantsForUser(
  env: Env,
  userId: string,
  appId?: string | null
): Promise<UserTenantAccessEntry[]> {
  const db = getDB(env);

  const conditions = ["m.user_id = ?", "m.status = 'active'"];
  const params: unknown[] = [userId];

  if (appId) {
    conditions.push("m.app_id = ?");
    params.push(appId);
  }

  const rows = await db
    .prepare(
      `SELECT m.tenant_id, m.app_id, m.role_key, t.tenant_key, t.name, t.status
       FROM ids_memberships m
       JOIN ids_tenants t ON t.id = m.tenant_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY m.app_id, t.name`
    )
    .bind(...params)
    .all<{
      tenant_id: string;
      app_id: string;
      role_key: string;
      tenant_key: string;
      name: string;
      status: string;
    }>();

  // Aggregate roles per tenant
  const tenantMap = new Map<
    string,
    {
      appId: string;
      tenantKey: string;
      name: string;
      status: string;
      roles: Set<string>;
    }
  >();

  for (const row of rows.results ?? []) {
    if (!tenantMap.has(row.tenant_id)) {
      tenantMap.set(row.tenant_id, {
        appId: row.app_id,
        tenantKey: row.tenant_key,
        name: row.name,
        status: row.status,
        roles: new Set(),
      });
    }
    tenantMap.get(row.tenant_id)!.roles.add(row.role_key);
  }

  return Array.from(tenantMap.entries()).map(([tenantId, entry]) => ({
    tenantId,
    appId: entry.appId,
    tenantKey: entry.tenantKey,
    name: entry.name,
    status: entry.status,
    roles: Array.from(entry.roles),
  }));
}

// ── Sanitize a platform context response ──────────────────────
// Strips any accidentally included sensitive fields.

export function sanitizePlatformContextResponse<T extends Record<string, unknown>>(
  input: T
): T {
  const forbidden = [
    "session_token_hash",
    "sessionTokenHash",
    "api_key_hash",
    "apiKeyHash",
    "key_hash",
    "keyHash",
    "password",
    "secret",
    "twilio_account_sid",
    "twilio_auth_token",
    "otp",
    "otp_code",
    "otpCode",
  ];
  const clean = { ...input };
  for (const key of forbidden) {
    if (key in clean) {
      delete clean[key];
    }
  }
  return clean;
}

// ── Get user platform summary ──────────────────────────────────

export interface GetUserPlatformSummaryInput {
  userId: string;
  requesterType: WritePlatformContextRequestInput["requesterType"];
  requesterClientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function getUserPlatformSummary(
  input: GetUserPlatformSummaryInput,
  env: Env
): Promise<{ ok: true; data: UserPlatformSummary } | { ok: false; error: string }> {
  const user = await getUserById(env, input.userId);

  if (!user) {
    await writePlatformContextRequest(env, {
      requesterType: input.requesterType,
      requesterClientId: input.requesterClientId,
      userId: input.userId,
      contextType: "platform_summary",
      success: false,
      reason: "User not found.",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { ok: false, error: "User not found." };
  }

  const [apps, trustSignals] = await Promise.all([
    listAccessibleAppsForUser(env, input.userId),
    buildTrustSignalsForUser(env, input.userId),
  ]);

  const safeUser: SafeUserSummary = {
    id: user.id,
    displayName: user.displayName ?? null,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
  };

  await writePlatformContextRequest(env, {
    requesterType: input.requesterType,
    requesterClientId: input.requesterClientId,
    userId: input.userId,
    contextType: "platform_summary",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await writeAuditLog(env, {
    eventType: "platform_context_requested",
    userId: input.userId,
    metadata: {
      contextType: "platform_summary",
      requesterType: input.requesterType,
      appCount: apps.length,
    },
  });

  return {
    ok: true,
    data: sanitizePlatformContextResponse({ user: safeUser, apps, trustSignals }) as UserPlatformSummary,
  };
}

// ── Get user app context ───────────────────────────────────────

export interface GetUserAppContextInput {
  userId: string;
  appId: string;
  tenantId?: string | null;
  requesterType: WritePlatformContextRequestInput["requesterType"];
  requesterClientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function getUserAppContext(
  input: GetUserAppContextInput,
  env: Env
): Promise<{ ok: true; data: UserAppContext } | { ok: false; error: string }> {
  const writeFailLog = async (reason: string) => {
    await writePlatformContextRequest(env, {
      requesterType: input.requesterType,
      requesterClientId: input.requesterClientId,
      userId: input.userId,
      targetAppId: input.appId,
      targetTenantId: input.tenantId,
      contextType: "user_app_context",
      success: false,
      reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  };

  const user = await getUserById(env, input.userId);
  if (!user) {
    await writeFailLog("User not found.");
    return { ok: false, error: "User not found." };
  }

  const app = await getAppByIdSilent(env, input.appId);
  if (!app) {
    await writeFailLog("App not found.");
    return { ok: false, error: "App not found." };
  }

  const safeUser: SafeUserSummary = {
    id: user.id,
    displayName: user.displayName ?? null,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
  };

  let tenantInfo = null;
  let membershipInfo = null;

  const tenantId = input.tenantId ?? null;

  if (tenantId) {
    const tenant = await getTenantByIdSilent(env, tenantId);
    if (tenant) {
      tenantInfo = {
        tenantId: tenant.id,
        tenantKey: tenant.tenantKey,
        name: tenant.name,
        status: tenant.status,
      };
    }

    const db = getDB(env);
    const membership = await db
      .prepare(
        `SELECT id, role_key, status, joined_at
         FROM ids_memberships
         WHERE user_id = ? AND app_id = ? AND tenant_id = ? AND status = 'active'
         LIMIT 1`
      )
      .bind(input.userId, input.appId, tenantId)
      .first<{ id: string; role_key: string; status: string; joined_at: string | null }>();

    if (membership) {
      membershipInfo = {
        membershipId: membership.id,
        roleKey: membership.role_key,
        status: membership.status,
        joinedAt: membership.joined_at,
      };
    }
  }

  const [roles, effectivePermissions, trustSignals] = await Promise.all([
    getRoleKeysForUserContext(env, input.userId, input.appId, tenantId),
    getPermissionsForUserContext(env, input.userId, input.appId, tenantId),
    buildTrustSignalsForUser(env, input.userId),
  ]);

  await writePlatformContextRequest(env, {
    requesterType: input.requesterType,
    requesterClientId: input.requesterClientId,
    userId: input.userId,
    targetAppId: input.appId,
    targetTenantId: tenantId,
    contextType: "user_app_context",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await writeAuditLog(env, {
    eventType: "platform_context_requested",
    userId: input.userId,
    appId: input.appId,
    tenantId: tenantId,
    metadata: {
      contextType: "user_app_context",
      requesterType: input.requesterType,
    },
  });

  if (input.appId) {
    await writeAppAccessLog(env, {
      appId: input.appId,
      userId: input.userId,
      tenantId: tenantId ?? undefined,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "platform_context_requested" },
    });
  }

  const data: UserAppContext = {
    user: safeUser,
    app: { appId: app.appId, name: app.name, status: app.status },
    tenant: tenantInfo,
    membership: membershipInfo,
    roles,
    effectivePermissions,
    trustSignals,
  };

  return { ok: true, data: sanitizePlatformContextResponse(data as unknown as Record<string, unknown>) as unknown as UserAppContext };
}
