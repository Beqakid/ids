import type { Env } from "../types/env";
import type { AppAccessEventType } from "../types/apps";
import { getDB } from "../lib/db";

export interface AppAccessLogInput {
  appId: string;
  userId?: string | null;
  tenantId?: string | null;
  eventType: AppAccessEventType;
  allowed?: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write an entry to ids_app_access_logs.
 * Returns the generated log id.
 */
export async function writeAppAccessLog(
  env: Env,
  input: AppAccessLogInput
): Promise<string> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_app_access_logs
         (id, app_id, user_id, tenant_id, event_type, allowed,
          reason, ip_address, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.appId,
      input.userId ?? null,
      input.tenantId ?? null,
      input.eventType,
      input.allowed ? 1 : 0,
      input.reason ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    )
    .run();

  return id;
}
