/**
 * Token types for Phase 5 — JWT token events and token management.
 */

// ── Token types ───────────────────────────────────────────────

export type TokenType = "access" | "service" | "bootstrap";

export const TOKEN_TYPES: readonly TokenType[] = [
  "access",
  "service",
  "bootstrap",
] as const;

// ── Token event types ─────────────────────────────────────────

export type TokenEventType =
  | "token_issued"
  | "token_exchange_attempt"
  | "token_exchange_failed"
  | "token_verified"
  | "token_verify_failed"
  | "token_revoked"
  | "token_expired"
  | "service_key_created"
  | "service_key_used"
  | "service_key_revoked"
  | "bootstrap_used";

export const TOKEN_EVENT_TYPES: readonly TokenEventType[] = [
  "token_issued",
  "token_exchange_attempt",
  "token_exchange_failed",
  "token_verified",
  "token_verify_failed",
  "token_revoked",
  "token_expired",
  "service_key_created",
  "service_key_used",
  "service_key_revoked",
  "bootstrap_used",
] as const;

// ── Token event record ────────────────────────────────────────

export interface IdsTokenEvent {
  id: string;
  userId: string | null;
  sessionId: string | null;
  appId: string | null;
  tenantId: string | null;
  tokenType: TokenType;
  eventType: TokenEventType;
  jti: string | null;
  subject: string | null;
  audience: string | null;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface IdsTokenEventRow {
  id: string;
  user_id: string | null;
  session_id: string | null;
  app_id: string | null;
  tenant_id: string | null;
  token_type: string;
  event_type: string;
  jti: string | null;
  subject: string | null;
  audience: string | null;
  success: number;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

// ── Revoked token record ──────────────────────────────────────

export interface IdsRevokedToken {
  id: string;
  jti: string;
  userId: string | null;
  sessionId: string | null;
  appId: string | null;
  tenantId: string | null;
  reason: string | null;
  revokedAt: string;
  expiresAt: string;
  createdAt: string;
}
