/**
 * Auth test helpers — Phase 5
 *
 * Provides utilities for:
 * - Creating service clients and API keys in tests.
 * - Generating signed IDS JWTs for test requests.
 * - Building auth headers.
 */

import { signJwt, createJti, getUnixTime } from "../../src/lib/jwt";

const TEST_JWT_SECRET = "test-jwt-secret-32-chars-minimum-00";
const TEST_BOOTSTRAP_KEY = "test-bootstrap-key-not-real";

// ── Bootstrap header ──────────────────────────────────────────

export function bootstrapHeader(): Record<string, string> {
  return { "x-ids-bootstrap-key": TEST_BOOTSTRAP_KEY };
}

// ── Service API key header ────────────────────────────────────

export function serviceKeyHeader(rawKey: string): Record<string, string> {
  return { "x-ids-service-key": rawKey };
}

// ── Bearer JWT header ─────────────────────────────────────────

export function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ── Build a test JWT ──────────────────────────────────────────

export interface TestTokenOptions {
  userId?: string;
  sessionId?: string;
  appId?: string;
  tenantId?: string | null;
  roles?: string[];
  permissions?: string[];
  expiresIn?: number;
  jti?: string;
  secret?: string;
  issuer?: string;
  typ?: string;
}

export async function buildTestJwt(
  opts: TestTokenOptions = {}
): Promise<string> {
  const secret = opts.secret ?? TEST_JWT_SECRET;
  const jti = opts.jti ?? createJti();
  const sub = opts.userId ?? crypto.randomUUID();
  const sid = opts.sessionId ?? crypto.randomUUID();
  const appId = opts.appId ?? "test_app";
  const tenantId = opts.tenantId ?? null;
  const expiresIn = opts.expiresIn ?? 900;
  const roles = opts.roles ?? [];
  const permissions = opts.permissions ?? [];
  const iss = opts.issuer ?? "ids";
  const typ = opts.typ ?? "access";

  return signJwt(
    {
      iss,
      sub,
      aud: appId,
      sid,
      app_id: appId,
      tenant_id: tenantId,
      roles,
      permissions,
      jti,
      typ,
    },
    secret,
    { expiresIn }
  );
}

// ── Expired JWT ───────────────────────────────────────────────

export async function buildExpiredJwt(opts: TestTokenOptions = {}): Promise<string> {
  return buildTestJwt({ ...opts, expiresIn: -60 });
}

// ── Wrong-issuer JWT ──────────────────────────────────────────

export async function buildWrongIssuerJwt(
  opts: TestTokenOptions = {}
): Promise<string> {
  return buildTestJwt({ ...opts, issuer: "not-ids" });
}

// ── Wrong-secret JWT ──────────────────────────────────────────

export async function buildWrongSecretJwt(
  opts: TestTokenOptions = {}
): Promise<string> {
  return buildTestJwt({
    ...opts,
    secret: "wrong-secret-that-is-at-least-32-chars-long",
  });
}
