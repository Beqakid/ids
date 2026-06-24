import type { Env } from "../types/env";
import type {
  IdsSession,
  IdsSessionRow,
  SessionStatus,
} from "../types/identity";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Hash a raw session token using Web Crypto SHA-256.
 * Always store the hash, never the raw token.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isSessionExpired(session: IdsSession): boolean {
  return new Date(session.expiresAt) < new Date();
}

function rowToSession(row: IdsSessionRow): IdsSession {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status as SessionStatus,
    appId: row.app_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
  };
}

// ── Create ───────────────────────────────────────────────────

export interface CreateSessionInput {
  userId: string;
  appId?: string;
  ttlSeconds?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateSessionResult {
  session: IdsSession;
  /** Raw token — returned ONLY at creation time. */
  rawToken: string;
}

export async function createSession(
  env: Env,
  input: CreateSessionInput
): Promise<CreateSessionResult> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  const tokenHash = await hashSessionToken(rawToken);
  const now = new Date();
  const ttl = input.ttlSeconds ?? 3600;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  await db
    .prepare(
      `INSERT INTO ids_sessions
         (id, user_id, session_token_hash, status, app_id,
          ip_address, user_agent, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId,
      tokenHash,
      input.appId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      now.toISOString(),
      expiresAt.toISOString(),
      now.toISOString()
    )
    .run();

  // Login event
  await db
    .prepare(
      `INSERT INTO ids_login_events
         (id, user_id, app_id, event_type, success, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, 'session_created', 1, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.appId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      now.toISOString()
    )
    .run();

  // Audit
  await writeAuditLog(env, {
    eventType: "session_created",
    userId: input.userId,
    appId: input.appId,
    metadata: { sessionId: id, ttlSeconds: ttl },
  });

  const session: IdsSession = {
    id,
    userId: input.userId,
    status: "active",
    appId: input.appId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revokedAt: null,
    lastSeenAt: now.toISOString(),
  };

  return { session, rawToken };
}

// ── Read ─────────────────────────────────────────────────────

export async function getSessionById(
  env: Env,
  sessionId: string
): Promise<IdsSession | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_sessions WHERE id = ?")
    .bind(sessionId)
    .first<IdsSessionRow>();
  return row ? rowToSession(row) : null;
}

export async function listSessionsForUser(
  env: Env,
  userId: string
): Promise<IdsSession[]> {
  const db = getDB(env);
  const rows = await db
    .prepare(
      "SELECT * FROM ids_sessions WHERE user_id = ? ORDER BY created_at DESC"
    )
    .bind(userId)
    .all<IdsSessionRow>();
  return (rows.results ?? []).map(rowToSession);
}

// ── Revoke ───────────────────────────────────────────────────

export async function revokeSession(
  env: Env,
  sessionId: string
): Promise<IdsSession | null> {
  const db = getDB(env);
  const now = new Date().toISOString();

  const existing = await getSessionById(env, sessionId);
  if (!existing) return null;

  await db
    .prepare(
      "UPDATE ids_sessions SET status = 'revoked', revoked_at = ? WHERE id = ?"
    )
    .bind(now, sessionId)
    .run();

  // Login event
  await db
    .prepare(
      `INSERT INTO ids_login_events
         (id, user_id, app_id, event_type, success, created_at)
       VALUES (?, ?, ?, 'session_revoked', 1, ?)`
    )
    .bind(crypto.randomUUID(), existing.userId, existing.appId ?? null, now)
    .run();

  // Audit
  await writeAuditLog(env, {
    eventType: "session_revoked",
    userId: existing.userId,
    appId: existing.appId,
    metadata: { sessionId },
  });

  return { ...existing, status: "revoked", revokedAt: now };
}

export async function revokeAllSessionsForUser(
  env: Env,
  userId: string
): Promise<number> {
  const db = getDB(env);
  const now = new Date().toISOString();

  const active = await db
    .prepare(
      "SELECT id, app_id FROM ids_sessions WHERE user_id = ? AND status = 'active'"
    )
    .bind(userId)
    .all<{ id: string; app_id: string | null }>();

  const sessions = active.results ?? [];
  if (sessions.length === 0) return 0;

  await db
    .prepare(
      "UPDATE ids_sessions SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND status = 'active'"
    )
    .bind(now, userId)
    .run();

  // Login event for each
  for (const s of sessions) {
    await db
      .prepare(
        `INSERT INTO ids_login_events
           (id, user_id, app_id, event_type, success, created_at)
         VALUES (?, ?, ?, 'session_revoked', 1, ?)`
      )
      .bind(crypto.randomUUID(), userId, s.app_id ?? null, now)
      .run();
  }

  // Audit
  await writeAuditLog(env, {
    eventType: "all_sessions_revoked",
    userId,
    metadata: { count: sessions.length },
  });

  return sessions.length;
}
