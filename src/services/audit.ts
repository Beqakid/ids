import type { Env } from "../types/env";
import { getDB } from "../lib/db";

export interface AuditLogInput {
  eventType: string;
  appId?: string | null;
  userId?: string | null;
  tenantId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write an entry to ids_audit_logs.
 * Returns the generated audit log id.
 */
export async function writeAuditLog(
  env: Env,
  input: AuditLogInput
): Promise<string> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO ids_audit_logs
         (id, event_type, app_id, user_id, tenant_id, actor_user_id,
          ip_address, user_agent, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.eventType,
      input.appId ?? null,
      input.userId ?? null,
      input.tenantId ?? null,
      input.actorUserId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    )
    .run();

  return id;
}
