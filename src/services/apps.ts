import type { Env } from "../types/env";
import type {
  IdsApp,
  IdsAppRow,
  AppStatus,
  AppType,
} from "../types/apps";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";

// ── Helpers ──────────────────────────────────────────────────

function parseOrigins(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  return raw
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}

function rowToApp(row: IdsAppRow): IdsApp {
  return {
    id: row.id,
    appId: row.app_id,
    name: row.name,
    appType: (row.app_type as AppType) ?? null,
    status: row.status as AppStatus,
    domain: row.domain,
    allowedOrigins: parseOrigins(row.allowed_origins),
    description: row.description ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── List ─────────────────────────────────────────────────────

export interface ListAppsOptions {
  limit?: number;
  offset?: number;
  status?: string;
  appType?: string;
}

export async function listApps(
  env: Env,
  opts: ListAppsOptions = {}
): Promise<IdsApp[]> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.appType) {
    conditions.push("app_type = ?");
    params.push(opts.appType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_apps ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`
    )
    .bind(...params, limit, offset)
    .all<IdsAppRow>();

  return (rows.results ?? []).map(rowToApp);
}

// ── Get ──────────────────────────────────────────────────────

export async function getAppById(
  env: Env,
  appId: string
): Promise<IdsApp | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_apps WHERE app_id = ?")
    .bind(appId)
    .first<IdsAppRow>();

  if (!row) return null;

  // Log app lookup
  await writeAppAccessLog(env, {
    appId,
    eventType: "app_lookup",
    allowed: true,
  });

  return rowToApp(row);
}

// ── Create ───────────────────────────────────────────────────

export interface CreateAppInput {
  appId: string;
  name: string;
  appType?: AppType;
  status?: AppStatus;
  domain?: string;
  allowedOrigins?: string[];
  description?: string;
}

export async function createApp(
  env: Env,
  input: CreateAppInput
): Promise<IdsApp> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = input.status ?? "planned";
  const originsJson = input.allowedOrigins
    ? JSON.stringify(input.allowedOrigins)
    : null;

  // Check duplicate
  const existing = await db
    .prepare("SELECT id FROM ids_apps WHERE app_id = ?")
    .bind(input.appId)
    .first();
  if (existing) {
    throw new DuplicateAppError("An app with this app_id already exists.");
  }

  await db
    .prepare(
      `INSERT INTO ids_apps
         (id, app_id, name, app_type, status, domain, allowed_origins,
          description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.appId,
      input.name,
      input.appType ?? null,
      status,
      input.domain ?? null,
      originsJson,
      input.description ?? null,
      now,
      now
    )
    .run();

  await writeAuditLog(env, {
    eventType: "app_created",
    appId: input.appId,
    metadata: { name: input.name, appType: input.appType, status },
  });

  return {
    id,
    appId: input.appId,
    name: input.name,
    appType: input.appType ?? null,
    status,
    domain: input.domain ?? null,
    allowedOrigins: input.allowedOrigins ?? [],
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Update ───────────────────────────────────────────────────

export interface UpdateAppInput {
  appId: string;
  name?: string;
  appType?: AppType;
  domain?: string | null;
  allowedOrigins?: string[];
  description?: string | null;
}

export async function updateApp(
  env: Env,
  input: UpdateAppInput
): Promise<IdsApp | null> {
  const db = getDB(env);
  const existing = await getAppByIdInternal(env, input.appId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];

  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.appType !== undefined) {
    sets.push("app_type = ?");
    params.push(input.appType);
  }
  if (input.domain !== undefined) {
    sets.push("domain = ?");
    params.push(input.domain);
  }
  if (input.allowedOrigins !== undefined) {
    sets.push("allowed_origins = ?");
    params.push(JSON.stringify(input.allowedOrigins));
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    params.push(input.description);
  }

  params.push(input.appId);

  await db
    .prepare(`UPDATE ids_apps SET ${sets.join(", ")} WHERE app_id = ?`)
    .bind(...params)
    .run();

  await writeAuditLog(env, {
    eventType: "app_updated",
    appId: input.appId,
    metadata: { fields: Object.keys(input).filter((k) => k !== "appId") },
  });

  // Return updated
  return getAppByIdInternal(env, input.appId);
}

// ── Update Status ────────────────────────────────────────────

export async function updateAppStatus(
  env: Env,
  appId: string,
  status: AppStatus
): Promise<IdsApp | null> {
  const db = getDB(env);
  const existing = await getAppByIdInternal(env, appId);
  if (!existing) return null;

  const now = new Date().toISOString();

  await db
    .prepare("UPDATE ids_apps SET status = ?, updated_at = ? WHERE app_id = ?")
    .bind(status, now, appId)
    .run();

  await writeAuditLog(env, {
    eventType: "app_status_updated",
    appId,
    metadata: { previousStatus: existing.status, newStatus: status },
  });

  return { ...existing, status, updatedAt: now };
}

// ── Active Check ─────────────────────────────────────────────

export async function isAppActive(env: Env, appId: string): Promise<boolean> {
  const app = await getAppByIdInternal(env, appId);
  if (!app) return false;

  await writeAppAccessLog(env, {
    appId,
    eventType: "app_access_checked",
    allowed: app.status === "active",
    reason: app.status === "active" ? undefined : `App status is ${app.status}`,
  });

  return app.status === "active";
}

// ── Origin Validation ────────────────────────────────────────

export async function validateAllowedOrigin(
  env: Env,
  appId: string,
  origin: string
): Promise<boolean> {
  const app = await getAppByIdInternal(env, appId);
  if (!app) return false;
  return app.allowedOrigins.includes(origin);
}

// ── Internal (no access log) ─────────────────────────────────

async function getAppByIdInternal(
  env: Env,
  appId: string
): Promise<IdsApp | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_apps WHERE app_id = ?")
    .bind(appId)
    .first<IdsAppRow>();
  return row ? rowToApp(row) : null;
}

/** Exported for use by other services that need silent checks. */
export { getAppByIdInternal as getAppByIdSilent };

// ── Errors ───────────────────────────────────────────────────

export class DuplicateAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateAppError";
  }
}
