import type { Env } from "../types/env";
import type {
  IdsPermission,
  IdsPermissionRow,
  PermissionRiskLevel,
  PermissionStatus,
} from "../types/permissions";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import {
  ValidationError,
  isValidPermissionKey,
  isValidRiskLevel,
  isAllowedValue,
} from "../lib/validation";
import { PERMISSION_STATUSES, PERMISSION_RISK_LEVELS } from "../types/permissions";

// ── Helpers ──────────────────────────────────────────────────

function rowToPermission(row: IdsPermissionRow): IdsPermission {
  return {
    id: row.id,
    permissionKey: row.permission_key,
    name: row.name,
    description: row.description,
    category: row.category,
    appId: row.app_id,
    riskLevel: row.risk_level as PermissionRiskLevel,
    status: row.status as PermissionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Create ───────────────────────────────────────────────────

export interface CreatePermissionInput {
  permissionKey: string;
  name: string;
  description?: string;
  category?: string;
  appId?: string;
  riskLevel?: string;
  status?: string;
}

export async function createPermission(
  env: Env,
  input: CreatePermissionInput
): Promise<IdsPermission> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (!isValidPermissionKey(input.permissionKey)) {
    throw new ValidationError(
      "permissionKey must be lowercase dot notation with at least one dot."
    );
  }

  const riskLevel = input.riskLevel ?? "low";
  if (!isValidRiskLevel(riskLevel)) {
    throw new ValidationError(`Invalid riskLevel. Allowed: ${PERMISSION_RISK_LEVELS.join(", ")}`);
  }

  const status = input.status ?? "active";
  if (!isAllowedValue(status, PERMISSION_STATUSES)) {
    throw new ValidationError(`Invalid status. Allowed: ${PERMISSION_STATUSES.join(", ")}`);
  }

  // Check duplicate
  const existing = await db
    .prepare("SELECT id FROM ids_permissions WHERE permission_key = ?")
    .bind(input.permissionKey)
    .first();
  if (existing) {
    throw new DuplicatePermissionKeyError(
      `Permission key '${input.permissionKey}' already exists.`
    );
  }

  await db
    .prepare(
      `INSERT INTO ids_permissions
         (id, permission_key, name, description, category, app_id, risk_level, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, input.permissionKey, input.name,
      input.description ?? null, input.category ?? null,
      input.appId ?? null, riskLevel, status, now, now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "permission_created",
    metadata: { permissionId: id, permissionKey: input.permissionKey },
  });

  return {
    id, permissionKey: input.permissionKey, name: input.name,
    description: input.description ?? null,
    category: input.category ?? null,
    appId: input.appId ?? null,
    riskLevel: riskLevel as PermissionRiskLevel,
    status: status as PermissionStatus,
    createdAt: now, updatedAt: now,
  };
}

// ── Read ─────────────────────────────────────────────────────

export async function getPermissionById(
  env: Env,
  permissionId: string
): Promise<IdsPermission | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_permissions WHERE id = ?")
    .bind(permissionId)
    .first<IdsPermissionRow>();
  return row ? rowToPermission(row) : null;
}

export async function getPermissionByKey(
  env: Env,
  permissionKey: string
): Promise<IdsPermission | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_permissions WHERE permission_key = ?")
    .bind(permissionKey)
    .first<IdsPermissionRow>();
  return row ? rowToPermission(row) : null;
}

// ── List ─────────────────────────────────────────────────────

export interface ListPermissionsOptions {
  limit: number;
  offset: number;
  appId?: string;
  category?: string;
  riskLevel?: string;
  status?: string;
}

export async function listPermissions(
  env: Env,
  opts: ListPermissionsOptions
): Promise<{ permissions: IdsPermission[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.appId) { conditions.push("app_id = ?"); params.push(opts.appId); }
  if (opts.category) { conditions.push("category = ?"); params.push(opts.category); }
  if (opts.riskLevel) { conditions.push("risk_level = ?"); params.push(opts.riskLevel); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_permissions ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_permissions ${where} ORDER BY permission_key ASC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsPermissionRow>();

  return { permissions: (rows.results ?? []).map(rowToPermission), total };
}

// ── Update ───────────────────────────────────────────────────

export interface UpdatePermissionInput {
  permissionId: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  riskLevel?: string;
}

export async function updatePermission(
  env: Env,
  input: UpdatePermissionInput
): Promise<IdsPermission | null> {
  const db = getDB(env);
  const existing = await getPermissionById(env, input.permissionId);
  if (!existing) return null;

  if (input.riskLevel && !isValidRiskLevel(input.riskLevel)) {
    throw new ValidationError(`Invalid riskLevel. Allowed: ${PERMISSION_RISK_LEVELS.join(", ")}`);
  }

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
  if (input.category !== undefined) { sets.push("category = ?"); params.push(input.category); }
  if (input.riskLevel !== undefined) { sets.push("risk_level = ?"); params.push(input.riskLevel); }

  params.push(input.permissionId);

  await db
    .prepare(`UPDATE ids_permissions SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();

  await writeAuditLog(env, {
    eventType: "permission_updated",
    metadata: { permissionId: input.permissionId, fields: Object.keys(input).filter(k => k !== "permissionId") },
  });

  return getPermissionById(env, input.permissionId);
}

// ── Update Status ────────────────────────────────────────────

export async function updatePermissionStatus(
  env: Env,
  permissionId: string,
  status: PermissionStatus
): Promise<IdsPermission | null> {
  const db = getDB(env);
  const existing = await getPermissionById(env, permissionId);
  if (!existing) return null;

  if (!isAllowedValue(status, PERMISSION_STATUSES)) {
    throw new ValidationError(`Invalid status. Allowed: ${PERMISSION_STATUSES.join(", ")}`);
  }

  const now = new Date().toISOString();

  await db
    .prepare("UPDATE ids_permissions SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, permissionId)
    .run();

  await writeAuditLog(env, {
    eventType: "permission_status_updated",
    metadata: { permissionId, previousStatus: existing.status, newStatus: status },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Validation Helper ────────────────────────────────────────

export { isValidPermissionKey };

// ── Errors ───────────────────────────────────────────────────

export class DuplicatePermissionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatePermissionKeyError";
  }
}
