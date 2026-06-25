/**
 * Service client service — Phase 5
 * Manages trusted internal service clients and their API keys.
 *
 * Security rules:
 * - client_id must be lowercase snake_case.
 * - Raw API key is returned ONLY once at creation.
 * - Only key_hash is stored in the database.
 * - key_hash is NEVER returned in any response.
 * - Service client must be active to authenticate.
 * - API key must be active and not expired.
 */

import type { Env } from "../types/env";
import type {
  IdsServiceClient,
  IdsServiceClientRow,
  IdsServiceApiKey,
  IdsServiceApiKeyRow,
  ServiceClientStatus,
  ServiceApiKeyStatus,
} from "../types/serviceClients";
import { getDB } from "../lib/db";
import {
  generateServiceApiKey,
  hashServiceApiKey,
  getApiKeyPrefix,
  verifyServiceApiKey,
} from "../lib/apiKeys";
import { writeAuditLog } from "./audit";
import { writeTokenEvent } from "./tokens";
import { isValidClientId } from "../lib/validation";

// ── Row helpers ───────────────────────────────────────────────

function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToServiceClient(row: IdsServiceClientRow): IdsServiceClient {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    appId: row.app_id,
    tenantId: row.tenant_id,
    status: row.status as ServiceClientStatus,
    scopes: parseJsonArray(row.scopes),
    allowedOrigins: parseJsonArray(row.allowed_origins),
    allowedIps: parseJsonArray(row.allowed_ips),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    metadata: parseMetadata(row.metadata),
  };
}

function rowToServiceApiKey(row: IdsServiceApiKeyRow): IdsServiceApiKey {
  return {
    id: row.id,
    serviceClientId: row.service_client_id,
    keyPrefix: row.key_prefix,
    // key_hash intentionally omitted
    status: row.status as ServiceApiKeyStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdByUserId: row.created_by_user_id,
    metadata: parseMetadata(row.metadata),
  };
}

// ── Service client CRUD ───────────────────────────────────────

export interface CreateServiceClientInput {
  clientId: string;
  name: string;
  appId?: string | null;
  tenantId?: string | null;
  scopes?: string[] | null;
  allowedOrigins?: string[] | null;
  allowedIps?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export class DuplicateClientIdError extends Error {
  constructor(clientId: string) {
    super(`Service client with client_id '${clientId}' already exists.`);
    this.name = "DuplicateClientIdError";
  }
}

export async function createServiceClient(
  env: Env,
  input: CreateServiceClientInput,
  actorUserId?: string | null
): Promise<IdsServiceClient> {
  if (!isValidClientId(input.clientId)) {
    throw new Error(
      "client_id must be lowercase snake_case (letters, digits, underscores)."
    );
  }

  const db = getDB(env);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await db
      .prepare(
        `INSERT INTO ids_service_clients
           (id, client_id, name, app_id, tenant_id, status, scopes,
            allowed_origins, allowed_ips, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.clientId,
        input.name,
        input.appId ?? null,
        input.tenantId ?? null,
        input.scopes ? JSON.stringify(input.scopes) : null,
        input.allowedOrigins ? JSON.stringify(input.allowedOrigins) : null,
        input.allowedIps ? JSON.stringify(input.allowedIps) : null,
        now,
        now,
        input.metadata ? JSON.stringify(input.metadata) : null
      )
      .run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      throw new DuplicateClientIdError(input.clientId);
    }
    throw err;
  }

  await writeAuditLog(env, {
    eventType: "service_client_created",
    actorUserId: actorUserId ?? null,
    metadata: { serviceClientId: id, clientId: input.clientId },
  });

  const row = await db
    .prepare("SELECT * FROM ids_service_clients WHERE id = ?")
    .bind(id)
    .first<IdsServiceClientRow>();

  return rowToServiceClient(row!);
}

export async function getServiceClientById(
  env: Env,
  id: string
): Promise<IdsServiceClient | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_service_clients WHERE id = ?")
    .bind(id)
    .first<IdsServiceClientRow>();
  return row ? rowToServiceClient(row) : null;
}

export async function getServiceClientByClientId(
  env: Env,
  clientId: string
): Promise<IdsServiceClient | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_service_clients WHERE client_id = ?")
    .bind(clientId)
    .first<IdsServiceClientRow>();
  return row ? rowToServiceClient(row) : null;
}

export interface ListServiceClientsOptions {
  limit?: number;
  offset?: number;
  status?: string;
}

export async function listServiceClients(
  env: Env,
  opts: ListServiceClientsOptions = {}
) {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_service_clients ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all<IdsServiceClientRow>();

  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM ids_service_clients ${where}`)
    .bind(...params)
    .first<{ total: number }>();

  return {
    serviceClients: (rows.results ?? []).map(rowToServiceClient),
    total: countRow?.total ?? 0,
    limit,
    offset,
  };
}

export async function updateServiceClientStatus(
  env: Env,
  id: string,
  status: ServiceClientStatus,
  actorUserId?: string | null
): Promise<IdsServiceClient | null> {
  const db = getDB(env);
  const now = new Date().toISOString();

  const existing = await getServiceClientById(env, id);
  if (!existing) return null;

  await db
    .prepare(
      "UPDATE ids_service_clients SET status = ?, updated_at = ? WHERE id = ?"
    )
    .bind(status, now, id)
    .run();

  await writeAuditLog(env, {
    eventType: "service_client_status_updated",
    actorUserId: actorUserId ?? null,
    metadata: {
      serviceClientId: id,
      clientId: existing.clientId,
      previousStatus: existing.status,
      newStatus: status,
    },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Service API keys ──────────────────────────────────────────

export interface CreateServiceApiKeyInput {
  expiresAt?: string | null;
  createdByUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateServiceApiKeyResult {
  apiKey: IdsServiceApiKey;
  /** Raw key — returned ONCE. Never store this after returning to caller. */
  rawKey: string;
}

export async function createServiceApiKey(
  env: Env,
  serviceClientId: string,
  input: CreateServiceApiKeyInput = {}
): Promise<CreateServiceApiKeyResult> {
  const client = await getServiceClientById(env, serviceClientId);
  if (!client) {
    throw new Error("Service client not found.");
  }

  const db = getDB(env);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const rawKey = generateServiceApiKey(client.clientId);
  const keyHash = await hashServiceApiKey(rawKey, env.IDS_API_KEY_PEPPER);
  const keyPrefix = getApiKeyPrefix(rawKey);

  await db
    .prepare(
      `INSERT INTO ids_service_api_keys
         (id, service_client_id, key_prefix, key_hash, status,
          created_at, updated_at, expires_at, created_by_user_id, metadata)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      serviceClientId,
      keyPrefix,
      keyHash,
      now,
      now,
      input.expiresAt ?? null,
      input.createdByUserId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    )
    .run();

  await writeTokenEvent(env, {
    tokenType: "service",
    eventType: "service_key_created",
    userId: input.createdByUserId,
    success: true,
    metadata: { serviceClientId, keyId: id, clientId: client.clientId },
  });

  await writeAuditLog(env, {
    eventType: "service_api_key_created",
    actorUserId: input.createdByUserId ?? null,
    metadata: { serviceClientId, keyId: id, clientId: client.clientId },
  });

  const row = await db
    .prepare("SELECT * FROM ids_service_api_keys WHERE id = ?")
    .bind(id)
    .first<IdsServiceApiKeyRow>();

  return {
    apiKey: rowToServiceApiKey(row!),
    rawKey,
  };
}

export async function listServiceApiKeys(
  env: Env,
  serviceClientId: string
): Promise<IdsServiceApiKey[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_service_api_keys WHERE service_client_id = ? ORDER BY created_at DESC"
    )
    .bind(serviceClientId)
    .all<IdsServiceApiKeyRow>();

  return (rows.results ?? []).map(rowToServiceApiKey);
}

export async function revokeServiceApiKey(
  env: Env,
  apiKeyId: string,
  actorUserId?: string | null
): Promise<IdsServiceApiKey | null> {
  const db = getDB(env);
  const now = new Date().toISOString();

  const existing = await db
    .prepare("SELECT * FROM ids_service_api_keys WHERE id = ?")
    .bind(apiKeyId)
    .first<IdsServiceApiKeyRow>();

  if (!existing) return null;

  await db
    .prepare(
      "UPDATE ids_service_api_keys SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?"
    )
    .bind(now, now, apiKeyId)
    .run();

  await writeTokenEvent(env, {
    tokenType: "service",
    eventType: "service_key_revoked",
    userId: actorUserId,
    success: true,
    metadata: { apiKeyId, serviceClientId: existing.service_client_id },
  });

  await writeAuditLog(env, {
    eventType: "service_api_key_revoked",
    actorUserId: actorUserId ?? null,
    metadata: { apiKeyId, serviceClientId: existing.service_client_id },
  });

  return rowToServiceApiKey({ ...existing, status: "revoked", revoked_at: now, updated_at: now });
}

// ── Verify service API key ────────────────────────────────────

export interface VerifyServiceKeyResult {
  ok: boolean;
  serviceClient?: IdsServiceClient;
  reason?: string;
}

export async function verifyServiceApiKeyForAuth(
  env: Env,
  rawKey: string
): Promise<VerifyServiceKeyResult> {
  const db = getDB(env);
  const prefix = getApiKeyPrefix(rawKey);

  // Look up by prefix (fast index lookup), then verify hash
  const keyRows = await db
    .prepare(
      "SELECT * FROM ids_service_api_keys WHERE key_prefix = ? AND status = 'active'"
    )
    .bind(prefix)
    .all<IdsServiceApiKeyRow>();

  const keyRow = (keyRows.results ?? []).find(async () => true); // will iterate below

  // Try all matching prefix rows (prefix collision safety)
  let matchedRow: IdsServiceApiKeyRow | null = null;
  for (const row of keyRows.results ?? []) {
    const valid = await verifyServiceApiKey(
      rawKey,
      row.key_hash,
      env.IDS_API_KEY_PEPPER
    );
    if (valid) {
      matchedRow = row;
      break;
    }
  }

  if (!matchedRow) {
    return { ok: false, reason: "KEY_NOT_FOUND" };
  }

  // Check expiry
  if (matchedRow.expires_at && new Date(matchedRow.expires_at) < new Date()) {
    await writeTokenEvent(env, {
      tokenType: "service",
      eventType: "service_key_used",
      success: false,
      reason: "KEY_EXPIRED",
    });
    return { ok: false, reason: "KEY_EXPIRED" };
  }

  // Look up service client
  const clientRow = await db
    .prepare("SELECT * FROM ids_service_clients WHERE id = ?")
    .bind(matchedRow.service_client_id)
    .first<IdsServiceClientRow>();

  if (!clientRow) {
    return { ok: false, reason: "CLIENT_NOT_FOUND" };
  }

  if (clientRow.status !== "active") {
    await writeTokenEvent(env, {
      tokenType: "service",
      eventType: "service_key_used",
      success: false,
      reason: "CLIENT_NOT_ACTIVE",
    });
    return { ok: false, reason: "CLIENT_NOT_ACTIVE" };
  }

  // Update last_used_at
  const now = new Date().toISOString();
  await db
    .prepare(
      "UPDATE ids_service_api_keys SET last_used_at = ? WHERE id = ?"
    )
    .bind(now, matchedRow.id)
    .run();
  await db
    .prepare(
      "UPDATE ids_service_clients SET last_used_at = ? WHERE id = ?"
    )
    .bind(now, clientRow.id)
    .run();

  await writeTokenEvent(env, {
    tokenType: "service",
    eventType: "service_key_used",
    success: true,
    metadata: {
      serviceClientId: clientRow.id,
      clientId: clientRow.client_id,
      keyId: matchedRow.id,
    },
  });

  return { ok: true, serviceClient: rowToServiceClient(clientRow) };
}
