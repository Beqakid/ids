/**
 * Auth types for Phase 5 — token issuing, service keys, and auth context.
 */

// ── Principal types ───────────────────────────────────────────

export type AuthPrincipalType =
  | "anonymous"
  | "user"
  | "service"
  | "bootstrap";

// ── Auth context ─────────────────────────────────────────────

/**
 * AuthContext is populated by the auth middleware and attached to the Hono
 * request context. Downstream handlers read this to understand who is calling.
 */
export interface AuthContext {
  /** How the caller identified itself. */
  principalType: AuthPrincipalType;
  /** True when the caller presented a valid credential. */
  authenticated: boolean;
  /** Why auth failed (for logging/debugging — never expose raw to clients). */
  reason?: string;

  // ── User principal fields ─────────────────────────────────
  userId?: string;
  sessionId?: string;
  appId?: string;
  tenantId?: string | null;

  // ── Service principal fields ──────────────────────────────
  serviceClientId?: string;
  clientId?: string;

  // ── Token fields (from JWT) ───────────────────────────────
  jti?: string;
  tokenType?: string;

  // ── Phase 4 roles/permissions (when available in JWT) ─────
  // TODO: Phase 6 — populate from effective permission checks after Phase 4 is wired.
  roles?: string[];
  permissions?: string[];
}
