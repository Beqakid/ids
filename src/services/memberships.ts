import type { Env } from "../types/env";
import type {
  IdsMembership,
  IdsMembershipRow,
  MembershipStatus,
} from "../types/memberships";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getAppByIdSilent } from "./apps";
import { getTenantByIdSilent } from "./tenants";
import { getUserById } from "./users";
import { ValidationError } from "../lib/validation";

// ── Helpers ──────────────────────────────────────────────────

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToMembership(row: IdsMembershipRow): IdsMembership {
  return {
    id: row.id,
    userId: row.user_id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    roleKey: row.role_key,
    status: row.status as MembershipStatus,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseMetadata(row.metadata),
  };
}

// ── Create ───────────────────────────────────────────────────

export interface CreateMembershipInput {
  userId: string;
  appId: string;
  tenantId: string;
  roleKey: string;
  status?: MembershipStatus;
  invitedByUserId?: string;
  metadata?: Record<string, unknown> | null;
}

export async function createMembership(
  env: Env,
  input: CreateMembershipInput
): Promise<IdsMembership> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = input.status ?? "active";

  // Verify user exists
  const user = await getUserById(env, input.userId);
  if (!user) {
    throw new ValidationError(`User '${input.userId}' not found.`);
  }

  // Verify app exists
  const app = await getAppByIdSilent(env, input.appId);
  if (!app) {
    throw new ValidationError(`App '${input.appId}' not found.`);
  }

  // Verify tenant exists
  const tenant = await getTenantByIdSilent(env, input.tenantId);
  if (!tenant) {
    throw new ValidationError(`Tenant '${input.tenantId}' not found.`);
  }

  // Verify tenant belongs to the same app
  if (tenant.appId !== input.appId) {
    throw new ValidationError(
      `Tenant '${input.tenantId}' does not belong to app '${input.appId}'.`
    );
  }

  // Verify inviter exists if provided
  if (input.invitedByUserId) {
    const inviter = await getUserById(env, input.invitedByUserId);
    if (!inviter) {
      throw new ValidationError(`Inviter user '${input.invitedByUserId}' not found.`);
    }
  }

  // Check duplicate user + tenant + role_key
  const existing = await db
    .prepare(
      "SELECT id FROM ids_memberships WHERE user_id = ? AND tenant_id = ? AND role_key = ?"
    )
    .bind(input.userId, input.tenantId, input.roleKey)
    .first();
  if (existing) {
    throw new DuplicateMembershipError(
      `User already has role '${input.roleKey}' in this tenant.`
    );
  }

  const joinedAt = status === "active" ? now : null;

  await db
    .prepare(
      `INSERT INTO ids_memberships
         (id, user_id, app_id, tenant_id, role_key, status,
          invited_by_user_id, joined_at, created_at, updated_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId,
      input.appId,
      input.tenantId,
      input.roleKey,
      status,
      input.invitedByUserId ?? null,
      joinedAt,
      now,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null
    )
    .run();

  await writeAuditLog(env, {
    eventType: "membership_created",
    appId: input.appId,
    userId: input.userId,
    tenantId: input.tenantId,
    metadata: { membershipId: id, roleKey: input.roleKey, status },
  });

  await writeAppAccessLog(env, {
    appId: input.appId,
    userId: input.userId,
    tenantId: input.tenantId,
    eventType: "membership_created",
    allowed: true,
  });

  return {
    id,
    userId: input.userId,
    appId: input.appId,
    tenantId: input.tenantId,
    roleKey: input.roleKey,
    status,
    invitedByUserId: input.invitedByUserId ?? null,
    joinedAt,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? null,
  };
}

// ── Read ─────────────────────────────────────────────────────

export async function getMembershipById(
  env: Env,
  membershipId: string
): Promise<IdsMembership | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_memberships WHERE id = ?")
    .bind(membershipId)
    .first<IdsMembershipRow>();
  return row ? rowToMembership(row) : null;
}

export async function listMembershipsForUser(
  env: Env,
  userId: string
): Promise<IdsMembership[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_memberships WHERE user_id = ? ORDER BY created_at DESC"
    )
    .bind(userId)
    .all<IdsMembershipRow>();

  await writeAppAccessLog(env, {
    appId: "ids",
    userId,
    eventType: "membership_lookup",
    allowed: true,
  });

  return (rows.results ?? []).map(rowToMembership);
}

export async function listMembershipsForTenant(
  env: Env,
  tenantId: string
): Promise<IdsMembership[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_memberships WHERE tenant_id = ? ORDER BY created_at DESC"
    )
    .bind(tenantId)
    .all<IdsMembershipRow>();

  await writeAppAccessLog(env, {
    appId: "ids",
    tenantId,
    eventType: "membership_lookup",
    allowed: true,
  });

  return (rows.results ?? []).map(rowToMembership);
}

export async function listMembershipsForApp(
  env: Env,
  appId: string
): Promise<IdsMembership[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_memberships WHERE app_id = ? ORDER BY created_at DESC"
    )
    .bind(appId)
    .all<IdsMembershipRow>();

  await writeAppAccessLog(env, {
    appId,
    eventType: "membership_lookup",
    allowed: true,
  });

  return (rows.results ?? []).map(rowToMembership);
}

// ── Update Status ────────────────────────────────────────────

export async function updateMembershipStatus(
  env: Env,
  membershipId: string,
  status: MembershipStatus
): Promise<IdsMembership | null> {
  const db = getDB(env);
  const existing = await getMembershipById(env, membershipId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const joinedAt =
    status === "active" && !existing.joinedAt ? now : existing.joinedAt;

  await db
    .prepare(
      "UPDATE ids_memberships SET status = ?, joined_at = ?, updated_at = ? WHERE id = ?"
    )
    .bind(status, joinedAt, now, membershipId)
    .run();

  await writeAuditLog(env, {
    eventType: "membership_status_updated",
    appId: existing.appId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    metadata: {
      membershipId,
      previousStatus: existing.status,
      newStatus: status,
    },
  });

  await writeAppAccessLog(env, {
    appId: existing.appId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    eventType: "membership_updated",
    allowed: true,
  });

  return { ...existing, status, joinedAt, updatedAt: now };
}

// ── Remove ───────────────────────────────────────────────────

export async function removeMembership(
  env: Env,
  membershipId: string
): Promise<IdsMembership | null> {
  const db = getDB(env);
  const existing = await getMembershipById(env, membershipId);
  if (!existing) return null;

  const now = new Date().toISOString();

  // Soft delete — mark as removed, do NOT hard delete
  await db
    .prepare(
      "UPDATE ids_memberships SET status = 'removed', updated_at = ? WHERE id = ?"
    )
    .bind(now, membershipId)
    .run();

  await writeAuditLog(env, {
    eventType: "membership_removed",
    appId: existing.appId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    metadata: { membershipId, previousStatus: existing.status },
  });

  await writeAppAccessLog(env, {
    appId: existing.appId,
    userId: existing.userId,
    tenantId: existing.tenantId,
    eventType: "membership_removed",
    allowed: true,
  });

  return { ...existing, status: "removed", updatedAt: now };
}

// ── Context ──────────────────────────────────────────────────

export interface UserTenantContext {
  user: { id: string; displayName: string | null; status: string } | null;
  app: { appId: string; name: string; status: string } | null;
  tenant: {
    id: string;
    tenantKey: string;
    name: string;
    status: string;
  } | null;
  membership: {
    id: string;
    roleKey: string;
    status: string;
  } | null;
  active: boolean;
}

export async function getUserTenantContext(
  env: Env,
  userId: string,
  appId: string,
  tenantId: string
): Promise<UserTenantContext> {
  const db = getDB(env);

  const user = await getUserById(env, userId);
  const app = await getAppByIdSilent(env, appId);
  const tenant = await getTenantByIdSilent(env, tenantId);

  // Find membership
  const membershipRow = await db
    .prepare(
      "SELECT * FROM ids_memberships WHERE user_id = ? AND app_id = ? AND tenant_id = ? AND status != 'removed' LIMIT 1"
    )
    .bind(userId, appId, tenantId)
    .first<IdsMembershipRow>();
  const membership = membershipRow ? rowToMembership(membershipRow) : null;

  // Determine active state
  const userActive = user !== null && user.status === "active";
  const appActive = app !== null && app.status === "active";
  const tenantActive = tenant !== null && tenant.status === "active";
  const membershipActive = membership !== null && membership.status === "active";
  const active = userActive && appActive && tenantActive && membershipActive;

  // Audit
  await writeAuditLog(env, {
    eventType: "user_context_lookup",
    appId,
    userId,
    tenantId,
    metadata: { active, membershipStatus: membership?.status ?? null },
  });

  // App access log
  await writeAppAccessLog(env, {
    appId,
    userId,
    tenantId,
    eventType: "membership_lookup",
    allowed: active,
    reason: !active
      ? `user=${userActive}, app=${appActive}, tenant=${tenantActive}, membership=${membershipActive}`
      : undefined,
  });

  return {
    user: user
      ? { id: user.id, displayName: user.displayName, status: user.status }
      : null,
    app: app ? { appId: app.appId, name: app.name, status: app.status } : null,
    tenant: tenant
      ? {
          id: tenant.id,
          tenantKey: tenant.tenantKey,
          name: tenant.name,
          status: tenant.status,
        }
      : null,
    membership: membership
      ? {
          id: membership.id,
          roleKey: membership.roleKey,
          status: membership.status,
        }
      : null,
    active,
  };
}

export async function userHasActiveMembership(
  env: Env,
  userId: string,
  appId: string,
  tenantId: string
): Promise<boolean> {
  const db = getDB(env);
  const row = await db
    .prepare(
      "SELECT id FROM ids_memberships WHERE user_id = ? AND app_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1"
    )
    .bind(userId, appId, tenantId)
    .first();
  return row !== null;
}

// ── Errors ───────────────────────────────────────────────────

export class DuplicateMembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateMembershipError";
  }
}
