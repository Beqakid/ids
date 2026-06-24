import type { Env } from "../types/env";
import type {
  IdsPermissionCheck,
  IdsPermissionCheckRow,
} from "../types/permissions";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getUserById } from "./users";
import { getAppByIdSilent } from "./apps";
import { getTenantByIdSilent } from "./tenants";
import { getPermissionByKey } from "./permissions";
import { ValidationError } from "../lib/validation";

// ── Helpers ──────────────────────────────────────────────────

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function rowToCheck(row: IdsPermissionCheckRow): IdsPermissionCheck {
  return {
    id: row.id,
    userId: row.user_id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    permissionKey: row.permission_key,
    allowed: row.allowed === 1,
    reason: row.reason,
    riskLevel: row.risk_level,
    source: row.source,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
  };
}

// ── Permission Check ─────────────────────────────────────────

export interface CheckPermissionInput {
  userId: string;
  appId: string;
  tenantId?: string | null;
  permissionKey: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CheckPermissionResult {
  allowed: boolean;
  reason: string;
  riskLevel: string | null;
  userId: string;
  appId: string;
  tenantId: string | null;
  permissionKey: string;
  matchedRoles: string[];
}

export async function checkPermission(
  env: Env,
  input: CheckPermissionInput
): Promise<CheckPermissionResult> {
  const db = getDB(env);
  const tenantId = input.tenantId ?? null;

  // Helper to write check + return deny
  async function deny(reason: string, riskLevel: string | null = null, membershipId: string | null = null): Promise<CheckPermissionResult> {
    await writePermissionCheck(env, {
      userId: input.userId, appId: input.appId, tenantId,
      membershipId, permissionKey: input.permissionKey,
      allowed: false, reason, riskLevel,
      source: input.source ?? "internal_api",
      metadata: input.metadata ?? null,
    });
    return {
      allowed: false, reason, riskLevel,
      userId: input.userId, appId: input.appId, tenantId,
      permissionKey: input.permissionKey, matchedRoles: [],
    };
  }

  // 1. Check user exists and status
  const user = await getUserById(env, input.userId);
  if (!user) return deny("User not found.");
  if (user.status === "suspended" || user.status === "blocked" || user.status === "deleted") {
    return deny(`User status is ${user.status}.`);
  }

  // 2. Check app exists and status
  const app = await getAppByIdSilent(env, input.appId);
  if (!app) return deny("App not found.");
  if (app.status === "suspended" || app.status === "deprecated" || app.status === "archived") {
    return deny(`App status is ${app.status}.`);
  }

  // 3. Check tenant if provided
  let membershipId: string | null = null;
  if (tenantId) {
    const tenant = await getTenantByIdSilent(env, tenantId);
    if (!tenant) return deny("Tenant not found.");
    if (tenant.status === "suspended" || tenant.status === "archived" || tenant.status === "deleted") {
      return deny(`Tenant status is ${tenant.status}.`);
    }

    // 4. Check active membership
    const membership = await db
      .prepare(
        "SELECT id, role_key, status FROM ids_memberships WHERE user_id = ? AND app_id = ? AND tenant_id = ? LIMIT 1"
      )
      .bind(input.userId, input.appId, tenantId)
      .first<{ id: string; role_key: string; status: string }>();

    if (!membership) return deny("No membership found for this user in this tenant.");
    if (membership.status !== "active") return deny(`Membership status is ${membership.status}.`);
    membershipId = membership.id;
  }

  // 5. Check permission exists and is active
  const permission = await getPermissionByKey(env, input.permissionKey);
  if (!permission) return deny("Permission not found.");
  if (permission.status !== "active") return deny(`Permission status is ${permission.status}.`);

  // 6. Check if risk_level is blocked
  if (permission.riskLevel === "blocked") {
    return deny("Permission risk level is blocked.", "blocked", membershipId);
  }

  // 7. Check user permission overrides
  const denyOverride = await db
    .prepare(
      `SELECT id FROM ids_user_permission_overrides
       WHERE user_id = ? AND permission_id = ? AND effect = 'deny' AND status = 'active'
       AND (app_id IS NULL OR app_id = ?)
       AND (tenant_id IS NULL OR tenant_id = ?)
       LIMIT 1`
    )
    .bind(input.userId, permission.id, input.appId, tenantId)
    .first();
  if (denyOverride) {
    return deny("Permission denied by user override.", permission.riskLevel, membershipId);
  }

  const allowOverride = await db
    .prepare(
      `SELECT id FROM ids_user_permission_overrides
       WHERE user_id = ? AND permission_id = ? AND effect = 'allow' AND status = 'active'
       AND (app_id IS NULL OR app_id = ?)
       AND (tenant_id IS NULL OR tenant_id = ?)
       LIMIT 1`
    )
    .bind(input.userId, permission.id, input.appId, tenantId)
    .first();
  if (allowOverride) {
    // Allow override (risk_level blocked is already handled above)
    await writePermissionCheck(env, {
      userId: input.userId, appId: input.appId, tenantId,
      membershipId, permissionKey: input.permissionKey,
      allowed: true, reason: "Permission granted by user override.",
      riskLevel: permission.riskLevel, source: input.source ?? "internal_api",
      metadata: input.metadata ?? null,
    });
    return {
      allowed: true, reason: "Permission granted by user override.",
      riskLevel: permission.riskLevel,
      userId: input.userId, appId: input.appId, tenantId,
      permissionKey: input.permissionKey, matchedRoles: [],
    };
  }

  // 8. Check role-based permissions
  // Find all role_keys for user in this context:
  //   a) global roles from memberships
  //   b) app/tenant roles from memberships
  const roleKeys = await getRoleKeysForUserContext(env, input.userId, input.appId, tenantId);

  if (roleKeys.length === 0) {
    return deny("No roles found for user in this context.", permission.riskLevel, membershipId);
  }

  // Find roles that have the permission
  const placeholders = roleKeys.map(() => "?").join(", ");
  const matchedRolesRows = await db
    .prepare(
      `SELECT DISTINCT r.role_key
       FROM ids_roles r
       JOIN ids_role_permissions rp ON rp.role_id = r.id
       WHERE r.role_key IN (${placeholders})
         AND r.status = 'active'
         AND rp.permission_id = ?`
    )
    .bind(...roleKeys, permission.id)
    .all<{ role_key: string }>();

  const matchedRoles = (matchedRolesRows.results ?? []).map(r => r.role_key);

  if (matchedRoles.length === 0) {
    return deny(
      "Permission not granted through any assigned role.",
      permission.riskLevel,
      membershipId
    );
  }

  // Allowed!
  const reason = `Permission granted through role ${matchedRoles.join(", ")}.`;
  await writePermissionCheck(env, {
    userId: input.userId, appId: input.appId, tenantId,
    membershipId, permissionKey: input.permissionKey,
    allowed: true, reason, riskLevel: permission.riskLevel,
    source: input.source ?? "internal_api",
    metadata: input.metadata ?? null,
  });

  await writeAppAccessLog(env, {
    appId: input.appId,
    userId: input.userId,
    tenantId: tenantId ?? undefined,
    eventType: "app_access_checked",
    allowed: true,
    reason,
    metadata: { permissionKey: input.permissionKey, matchedRoles },
  });

  return {
    allowed: true, reason, riskLevel: permission.riskLevel,
    userId: input.userId, appId: input.appId, tenantId,
    permissionKey: input.permissionKey, matchedRoles,
  };
}

// ── Write Permission Check ───────────────────────────────────

export interface WritePermissionCheckInput {
  userId: string;
  appId: string;
  tenantId: string | null;
  membershipId: string | null;
  permissionKey: string;
  allowed: boolean;
  reason: string;
  riskLevel: string | null;
  source: string;
  metadata: Record<string, unknown> | null;
}

export async function writePermissionCheck(
  env: Env,
  input: WritePermissionCheckInput
): Promise<string> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_permission_checks
         (id, user_id, app_id, tenant_id, membership_id, permission_key,
          allowed, reason, risk_level, source, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, input.userId, input.appId, input.tenantId, input.membershipId,
      input.permissionKey, input.allowed ? 1 : 0, input.reason,
      input.riskLevel, input.source,
      input.metadata ? JSON.stringify(input.metadata) : null, now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "permission_check_run",
    appId: input.appId,
    userId: input.userId,
    tenantId: input.tenantId ?? undefined,
    metadata: {
      permissionKey: input.permissionKey,
      allowed: input.allowed,
      reason: input.reason,
    },
  });

  await writeAppAccessLog(env, {
    appId: input.appId,
    userId: input.userId,
    tenantId: input.tenantId ?? undefined,
    eventType: "app_access_checked",
    allowed: input.allowed,
    reason: input.reason,
    metadata: { permissionKey: input.permissionKey },
  });

  return id;
}

// ── List Permission Checks ───────────────────────────────────

export interface ListPermissionChecksOptions {
  limit: number;
  offset: number;
  userId?: string;
  appId?: string;
  tenantId?: string;
  permissionKey?: string;
  allowed?: string;
}

export async function listPermissionChecks(
  env: Env,
  opts: ListPermissionChecksOptions
): Promise<{ checks: IdsPermissionCheck[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) { conditions.push("user_id = ?"); params.push(opts.userId); }
  if (opts.appId) { conditions.push("app_id = ?"); params.push(opts.appId); }
  if (opts.tenantId) { conditions.push("tenant_id = ?"); params.push(opts.tenantId); }
  if (opts.permissionKey) { conditions.push("permission_key = ?"); params.push(opts.permissionKey); }
  if (opts.allowed !== undefined) { conditions.push("allowed = ?"); params.push(opts.allowed === "true" || opts.allowed === "1" ? 1 : 0); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_permission_checks ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_permission_checks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsPermissionCheckRow>();

  return { checks: (rows.results ?? []).map(rowToCheck), total };
}

// ── User Context Helpers ─────────────────────────────────────

export async function getRoleKeysForUserContext(
  env: Env,
  userId: string,
  appId: string,
  tenantId: string | null
): Promise<string[]> {
  const db = getDB(env);
  const roleKeys: Set<string> = new Set();

  // Get role_keys from memberships for this app (any tenant if no tenantId specified)
  if (tenantId) {
    const rows = await db
      .prepare(
        "SELECT DISTINCT role_key FROM ids_memberships WHERE user_id = ? AND app_id = ? AND tenant_id = ? AND status = 'active'"
      )
      .bind(userId, appId, tenantId)
      .all<{ role_key: string }>();
    for (const r of rows.results ?? []) roleKeys.add(r.role_key);
  } else {
    const rows = await db
      .prepare(
        "SELECT DISTINCT role_key FROM ids_memberships WHERE user_id = ? AND app_id = ? AND status = 'active'"
      )
      .bind(userId, appId)
      .all<{ role_key: string }>();
    for (const r of rows.results ?? []) roleKeys.add(r.role_key);
  }

  return Array.from(roleKeys);
}

export async function getPermissionsForUserContext(
  env: Env,
  userId: string,
  appId: string,
  tenantId: string | null
): Promise<string[]> {
  const db = getDB(env);
  const roleKeys = await getRoleKeysForUserContext(env, userId, appId, tenantId);

  if (roleKeys.length === 0) return [];

  const placeholders = roleKeys.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT DISTINCT p.permission_key
       FROM ids_roles r
       JOIN ids_role_permissions rp ON rp.role_id = r.id
       JOIN ids_permissions p ON p.id = rp.permission_id
       WHERE r.role_key IN (${placeholders})
         AND r.status = 'active'
         AND p.status = 'active'
       ORDER BY p.permission_key ASC`
    )
    .bind(...roleKeys)
    .all<{ permission_key: string }>();

  await writeAuditLog(env, {
    eventType: "user_effective_permissions_lookup",
    appId,
    userId,
    tenantId: tenantId ?? undefined,
    metadata: { roleKeys, permissionCount: (rows.results ?? []).length },
  });

  await writeAppAccessLog(env, {
    appId,
    userId,
    tenantId: tenantId ?? undefined,
    eventType: "app_access_checked",
    allowed: true,
    metadata: { action: "effective_permissions_lookup" },
  });

  return (rows.results ?? []).map(r => r.permission_key);
}
