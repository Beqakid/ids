import type { Env } from "../types/env";
import type {
  IdsTenant,
  IdsTenantRow,
  TenantStatus,
  TenantType,
} from "../types/tenants";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getAppByIdSilent } from "./apps";
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

function rowToTenant(row: IdsTenantRow): IdsTenant {
  return {
    id: row.id,
    appId: row.app_id,
    tenantKey: row.tenant_key,
    name: row.name,
    tenantType: row.tenant_type as TenantType,
    status: row.status as TenantStatus,
    ownerUserId: row.owner_user_id,
    domain: row.domain,
    metadata: parseMetadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Normalize ────────────────────────────────────────────────

export function normalizeTenantKey(value: string): string {
  return value.trim().toLowerCase();
}

// ── Create ───────────────────────────────────────────────────

export interface CreateTenantInput {
  appId: string;
  tenantKey: string;
  name: string;
  tenantType: TenantType;
  status?: TenantStatus;
  ownerUserId?: string;
  domain?: string;
  metadata?: Record<string, unknown> | null;
}

export async function createTenant(
  env: Env,
  input: CreateTenantInput
): Promise<IdsTenant> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = input.status ?? "active";
  const tenantKey = normalizeTenantKey(input.tenantKey);

  // Verify app exists
  const app = await getAppByIdSilent(env, input.appId);
  if (!app) {
    throw new ValidationError(`App '${input.appId}' not found.`);
  }

  // Verify owner exists if provided
  if (input.ownerUserId) {
    const owner = await getUserById(env, input.ownerUserId);
    if (!owner) {
      throw new ValidationError(`Owner user '${input.ownerUserId}' not found.`);
    }
  }

  // Check duplicate tenant_key within same app
  const existing = await db
    .prepare(
      "SELECT id FROM ids_tenants WHERE app_id = ? AND tenant_key = ?"
    )
    .bind(input.appId, tenantKey)
    .first();
  if (existing) {
    throw new DuplicateTenantKeyError(
      `Tenant key '${tenantKey}' already exists for app '${input.appId}'.`
    );
  }

  await db
    .prepare(
      `INSERT INTO ids_tenants
         (id, app_id, tenant_key, name, tenant_type, status,
          owner_user_id, domain, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.appId,
      tenantKey,
      input.name,
      input.tenantType,
      status,
      input.ownerUserId ?? null,
      input.domain ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "tenant_created",
    appId: input.appId,
    tenantId: id,
    metadata: { tenantKey, name: input.name, tenantType: input.tenantType },
  });

  return {
    id,
    appId: input.appId,
    tenantKey,
    name: input.name,
    tenantType: input.tenantType,
    status,
    ownerUserId: input.ownerUserId ?? null,
    domain: input.domain ?? null,
    metadata: input.metadata ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Read ─────────────────────────────────────────────────────

export async function getTenantById(
  env: Env,
  tenantId: string
): Promise<IdsTenant | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_tenants WHERE id = ?")
    .bind(tenantId)
    .first<IdsTenantRow>();
  if (!row) return null;

  await writeAppAccessLog(env, {
    appId: row.app_id,
    tenantId,
    eventType: "tenant_lookup",
    allowed: true,
  });

  return rowToTenant(row);
}

export async function getTenantByKey(
  env: Env,
  appId: string,
  tenantKey: string
): Promise<IdsTenant | null> {
  const db = getDB(env);
  const row = await db
    .prepare(
      "SELECT * FROM ids_tenants WHERE app_id = ? AND tenant_key = ?"
    )
    .bind(appId, normalizeTenantKey(tenantKey))
    .first<IdsTenantRow>();
  if (!row) return null;

  await writeAppAccessLog(env, {
    appId,
    tenantId: row.id,
    eventType: "tenant_lookup",
    allowed: true,
  });

  return rowToTenant(row);
}

// ── List ─────────────────────────────────────────────────────

export interface ListTenantsOptions {
  limit: number;
  offset: number;
  appId?: string;
  status?: string;
  tenantType?: string;
  ownerUserId?: string;
}

export async function listTenants(
  env: Env,
  opts: ListTenantsOptions
): Promise<{ tenants: IdsTenant[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.appId) {
    conditions.push("app_id = ?");
    params.push(opts.appId);
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.tenantType) {
    conditions.push("tenant_type = ?");
    params.push(opts.tenantType);
  }
  if (opts.ownerUserId) {
    conditions.push("owner_user_id = ?");
    params.push(opts.ownerUserId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_tenants ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_tenants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsTenantRow>();

  return {
    tenants: (rows.results ?? []).map(rowToTenant),
    total,
  };
}

// ── Update ───────────────────────────────────────────────────

export interface UpdateTenantInput {
  tenantId: string;
  name?: string;
  domain?: string | null;
  ownerUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function updateTenant(
  env: Env,
  input: UpdateTenantInput
): Promise<IdsTenant | null> {
  const db = getDB(env);
  const existing = await getTenantByIdInternal(env, input.tenantId);
  if (!existing) return null;

  // Verify owner exists if provided
  if (input.ownerUserId) {
    const owner = await getUserById(env, input.ownerUserId);
    if (!owner) {
      throw new ValidationError(`Owner user '${input.ownerUserId}' not found.`);
    }
  }

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.domain !== undefined) {
    sets.push("domain = ?");
    params.push(input.domain);
  }
  if (input.ownerUserId !== undefined) {
    sets.push("owner_user_id = ?");
    params.push(input.ownerUserId);
  }
  if (input.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(input.metadata ? JSON.stringify(input.metadata) : null);
  }

  params.push(input.tenantId);

  await db
    .prepare(`UPDATE ids_tenants SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();

  await writeAuditLog(env, {
    eventType: "tenant_updated",
    appId: existing.appId,
    tenantId: input.tenantId,
    metadata: { fields: Object.keys(input).filter((k) => k !== "tenantId") },
  });

  return getTenantByIdInternal(env, input.tenantId);
}

// ── Update Status ────────────────────────────────────────────

export async function updateTenantStatus(
  env: Env,
  tenantId: string,
  status: TenantStatus
): Promise<IdsTenant | null> {
  const db = getDB(env);
  const existing = await getTenantByIdInternal(env, tenantId);
  if (!existing) return null;

  const now = new Date().toISOString();

  await db
    .prepare("UPDATE ids_tenants SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, tenantId)
    .run();

  await writeAuditLog(env, {
    eventType: "tenant_status_updated",
    appId: existing.appId,
    tenantId,
    metadata: { previousStatus: existing.status, newStatus: status },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Owner Tenants ────────────────────────────────────────────

export async function listTenantsForOwner(
  env: Env,
  userId: string
): Promise<IdsTenant[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_tenants WHERE owner_user_id = ? ORDER BY created_at DESC"
    )
    .bind(userId)
    .all<IdsTenantRow>();
  return (rows.results ?? []).map(rowToTenant);
}

// ── Internal (no access log) ─────────────────────────────────

async function getTenantByIdInternal(
  env: Env,
  tenantId: string
): Promise<IdsTenant | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_tenants WHERE id = ?")
    .bind(tenantId)
    .first<IdsTenantRow>();
  return row ? rowToTenant(row) : null;
}

export { getTenantByIdInternal as getTenantByIdSilent };

// ── Errors ───────────────────────────────────────────────────

export class DuplicateTenantKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateTenantKeyError";
  }
}
