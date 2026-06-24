import type { Env } from "../types/env";
import type {
  IdsRole,
  IdsRoleRow,
  RoleScope,
  RoleStatus,
} from "../types/roles";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getAppByIdSilent } from "./apps";
import { getTenantByIdSilent } from "./tenants";
import {
  ValidationError,
  isValidRoleKey,
  isValidRoleScope,
  isAllowedValue,
} from "../lib/validation";
import { ROLE_STATUSES } from "../types/roles";

// ── Helpers ──────────────────────────────────────────────────

function rowToRole(row: IdsRoleRow): IdsRole {
  return {
    id: row.id,
    roleKey: row.role_key,
    name: row.name,
    description: row.description,
    scope: row.scope as RoleScope,
    appId: row.app_id,
    tenantId: row.tenant_id,
    status: row.status as RoleStatus,
    isSystemRole: row.is_system_role === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Create ───────────────────────────────────────────────────

export interface CreateRoleInput {
  roleKey: string;
  name: string;
  description?: string;
  scope: string;
  appId?: string | null;
  tenantId?: string | null;
  status?: string;
}

export async function createRole(
  env: Env,
  input: CreateRoleInput
): Promise<IdsRole> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!isValidRoleKey(input.roleKey)) {
    throw new ValidationError("roleKey must be lowercase snake_case.");
  }
  if (!isValidRoleScope(input.scope)) {
    throw new ValidationError("scope must be global, app, or tenant.");
  }

  const status = input.status ?? "active";
  if (!isAllowedValue(status, ROLE_STATUSES)) {
    throw new ValidationError(`Invalid status. Allowed: ${ROLE_STATUSES.join(", ")}`);
  }

  const appId = input.appId ?? null;
  const tenantId = input.tenantId ?? null;

  // Scope validation
  if (input.scope === "app" && !appId) {
    throw new ValidationError("App-scoped role must have an appId.");
  }
  if (input.scope === "tenant") {
    if (!appId) throw new ValidationError("Tenant-scoped role must have an appId.");
    if (!tenantId) throw new ValidationError("Tenant-scoped role must have a tenantId.");
  }

  // Verify app exists if provided
  if (appId) {
    const app = await getAppByIdSilent(env, appId);
    if (!app) throw new ValidationError(`App '${appId}' not found.`);
  }

  // Verify tenant exists if provided
  if (tenantId) {
    const tenant = await getTenantByIdSilent(env, tenantId);
    if (!tenant) throw new ValidationError(`Tenant '${tenantId}' not found.`);
    if (appId && tenant.appId !== appId) {
      throw new ValidationError(`Tenant '${tenantId}' does not belong to app '${appId}'.`);
    }
  }

  // Check duplicate (role_key + scope + app_id + tenant_id)
  const existing = await db
    .prepare(
      `SELECT id FROM ids_roles
       WHERE role_key = ? AND scope = ?
         AND COALESCE(app_id, '__null__') = COALESCE(?, '__null__')
         AND COALESCE(tenant_id, '__null__') = COALESCE(?, '__null__')`
    )
    .bind(input.roleKey, input.scope, appId, tenantId)
    .first();
  if (existing) {
    throw new DuplicateRoleError("A role with this key already exists in the same scope.");
  }

  await db
    .prepare(
      `INSERT INTO ids_roles
         (id, role_key, name, description, scope, app_id, tenant_id, status, is_system_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .bind(
      id, input.roleKey, input.name, input.description ?? null,
      input.scope, appId, tenantId, status, now, now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "role_created",
    appId: appId ?? undefined,
    metadata: { roleId: id, roleKey: input.roleKey, scope: input.scope },
  });

  return {
    id, roleKey: input.roleKey, name: input.name,
    description: input.description ?? null,
    scope: input.scope as RoleScope,
    appId, tenantId,
    status: status as RoleStatus,
    isSystemRole: false,
    createdAt: now, updatedAt: now,
  };
}

// ── Read ─────────────────────────────────────────────────────

export async function getRoleById(
  env: Env,
  roleId: string
): Promise<IdsRole | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_roles WHERE id = ?")
    .bind(roleId)
    .first<IdsRoleRow>();
  return row ? rowToRole(row) : null;
}

export async function getRoleByKey(
  env: Env,
  input: { roleKey: string; scope?: string; appId?: string | null; tenantId?: string | null }
): Promise<IdsRole | null> {
  const db = getDB(env);
  const conditions: string[] = ["role_key = ?"];
  const params: unknown[] = [input.roleKey];

  if (input.scope) {
    conditions.push("scope = ?");
    params.push(input.scope);
  }
  if (input.appId !== undefined) {
    conditions.push("COALESCE(app_id, '__null__') = COALESCE(?, '__null__')");
    params.push(input.appId ?? null);
  }
  if (input.tenantId !== undefined) {
    conditions.push("COALESCE(tenant_id, '__null__') = COALESCE(?, '__null__')");
    params.push(input.tenantId ?? null);
  }

  const row = await db
    .prepare(`SELECT * FROM ids_roles WHERE ${conditions.join(" AND ")} LIMIT 1`)
    .bind(...params)
    .first<IdsRoleRow>();
  return row ? rowToRole(row) : null;
}

// ── List ─────────────────────────────────────────────────────

export interface ListRolesOptions {
  limit: number;
  offset: number;
  appId?: string;
  tenantId?: string;
  scope?: string;
  status?: string;
}

export async function listRoles(
  env: Env,
  opts: ListRolesOptions
): Promise<{ roles: IdsRole[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.appId) { conditions.push("app_id = ?"); params.push(opts.appId); }
  if (opts.tenantId) { conditions.push("tenant_id = ?"); params.push(opts.tenantId); }
  if (opts.scope) { conditions.push("scope = ?"); params.push(opts.scope); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_roles ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(`SELECT * FROM ids_roles ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
    .bind(...params, opts.limit, opts.offset)
    .all<IdsRoleRow>();

  await writeAppAccessLog(env, {
    appId: opts.appId ?? "ids",
    eventType: "app_lookup",
    allowed: true,
    metadata: { action: "role_lookup" },
  });

  return { roles: (rows.results ?? []).map(rowToRole), total };
}

export async function listRolesForApp(
  env: Env,
  appId: string
): Promise<IdsRole[]> {
  const result = await listRoles(env, { limit: 100, offset: 0, appId });
  return result.roles;
}

export async function listRolesForTenant(
  env: Env,
  tenantId: string
): Promise<IdsRole[]> {
  const result = await listRoles(env, { limit: 100, offset: 0, tenantId });
  return result.roles;
}

// ── Update ───────────────────────────────────────────────────

export interface UpdateRoleInput {
  roleId: string;
  name?: string;
  description?: string | null;
}

export async function updateRole(
  env: Env,
  input: UpdateRoleInput
): Promise<IdsRole | null> {
  const db = getDB(env);
  const existing = await getRoleById(env, input.roleId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }

  params.push(input.roleId);

  await db
    .prepare(`UPDATE ids_roles SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();

  await writeAuditLog(env, {
    eventType: "role_updated",
    appId: existing.appId ?? undefined,
    metadata: { roleId: input.roleId, fields: Object.keys(input).filter(k => k !== "roleId") },
  });

  return { ...existing, ...( input.name !== undefined ? { name: input.name } : {}), ...( input.description !== undefined ? { description: input.description } : {}), updatedAt: now };
}

// ── Update Status ────────────────────────────────────────────

export async function updateRoleStatus(
  env: Env,
  roleId: string,
  status: RoleStatus
): Promise<IdsRole | null> {
  const db = getDB(env);
  const existing = await getRoleById(env, roleId);
  if (!existing) return null;

  if (!isAllowedValue(status, ROLE_STATUSES)) {
    throw new ValidationError(`Invalid status. Allowed: ${ROLE_STATUSES.join(", ")}`);
  }

  const now = new Date().toISOString();

  await db
    .prepare("UPDATE ids_roles SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, roleId)
    .run();

  await writeAuditLog(env, {
    eventType: "role_status_updated",
    appId: existing.appId ?? undefined,
    metadata: { roleId, previousStatus: existing.status, newStatus: status },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Role Permission Mapping ──────────────────────────────────

export async function assignPermissionToRole(
  env: Env,
  roleId: string,
  permissionId: string,
  createdByUserId?: string
): Promise<{ id: string }> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Check role exists
  const role = await getRoleById(env, roleId);
  if (!role) throw new ValidationError(`Role '${roleId}' not found.`);

  // Check permission exists
  const perm = await db
    .prepare("SELECT id FROM ids_permissions WHERE id = ?")
    .bind(permissionId)
    .first();
  if (!perm) throw new ValidationError(`Permission '${permissionId}' not found.`);

  // Check duplicate
  const existing = await db
    .prepare("SELECT id FROM ids_role_permissions WHERE role_id = ? AND permission_id = ?")
    .bind(roleId, permissionId)
    .first();
  if (existing) {
    throw new DuplicateRolePermissionError("This permission is already assigned to this role.");
  }

  await db
    .prepare(
      `INSERT INTO ids_role_permissions (id, role_id, permission_id, created_at, created_by_user_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, roleId, permissionId, now, createdByUserId ?? null)
    .run();

  await writeAuditLog(env, {
    eventType: "role_permission_assigned",
    appId: role.appId ?? undefined,
    metadata: { roleId, permissionId, roleKey: role.roleKey },
  });

  return { id };
}

export async function removePermissionFromRole(
  env: Env,
  roleId: string,
  permissionId: string
): Promise<boolean> {
  const db = getDB(env);

  const role = await getRoleById(env, roleId);
  if (!role) throw new ValidationError(`Role '${roleId}' not found.`);

  const existing = await db
    .prepare("SELECT id FROM ids_role_permissions WHERE role_id = ? AND permission_id = ?")
    .bind(roleId, permissionId)
    .first();
  if (!existing) return false;

  await db
    .prepare("DELETE FROM ids_role_permissions WHERE role_id = ? AND permission_id = ?")
    .bind(roleId, permissionId)
    .run();

  await writeAuditLog(env, {
    eventType: "role_permission_removed",
    appId: role.appId ?? undefined,
    metadata: { roleId, permissionId, roleKey: role.roleKey },
  });

  return true;
}

export async function listPermissionsForRole(
  env: Env,
  roleId: string
): Promise<{ permissionId: string; permissionKey: string; name: string; riskLevel: string }[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      `SELECT p.id, p.permission_key, p.name, p.risk_level
       FROM ids_role_permissions rp
       JOIN ids_permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.permission_key ASC`
    )
    .bind(roleId)
    .all<{ id: string; permission_key: string; name: string; risk_level: string }>();

  return (rows.results ?? []).map(r => ({
    permissionId: r.id,
    permissionKey: r.permission_key,
    name: r.name,
    riskLevel: r.risk_level,
  }));
}

// ── Errors ───────────────────────────────────────────────────

export class DuplicateRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRoleError";
  }
}

export class DuplicateRolePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRolePermissionError";
  }
}
