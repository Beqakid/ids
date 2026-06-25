/**
 * Lightweight validation helpers — no external dependencies.
 */

export function requireString(
  value: unknown,
  field: string
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required and must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function isAllowedValue<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parseLimitOffset(
  rawLimit: unknown,
  rawOffset: unknown,
  defaults: { limit: number; offset: number } = { limit: 25, offset: 0 }
): PaginationParams {
  let limit = defaults.limit;
  let offset = defaults.offset;

  if (rawLimit !== undefined && rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isNaN(n) && n > 0) limit = Math.min(n, 100);
  }
  if (rawOffset !== undefined && rawOffset !== null) {
    const n = Number(rawOffset);
    if (!Number.isNaN(n) && n >= 0) offset = n;
  }

  return { limit, offset };
}

// ── Phase 3 additions ────────────────────────────────────────

/** app_id must be lowercase snake_case (letters, digits, underscores). */
const APP_ID_RE = /^[a-z][a-z0-9_]*$/;

export function isValidAppId(value: string): boolean {
  return APP_ID_RE.test(value);
}

/** tenant_key must be lowercase letters, digits, and hyphens. URL/subdomain safe. */
const TENANT_KEY_RE = /^[a-z][a-z0-9-]*$/;

export function isValidTenantKey(value: string): boolean {
  return TENANT_KEY_RE.test(value);
}

/** role_key must be lowercase snake_case (letters, digits, underscores). */
const ROLE_KEY_RE = /^[a-z][a-z0-9_]*$/;

export function isValidRoleKey(value: string): boolean {
  return ROLE_KEY_RE.test(value);
}

/** Basic origin validation — must start with http:// or https:// */
export function isValidOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parse and validate a JSON metadata field. Returns parsed object or null. */
export function parseJsonMetadata(
  value: unknown
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  throw new ValidationError("metadata must be a valid JSON object.");
}

/** Validate that a value is in an allowed set, with a friendly error. */
export function validateAllowedArrayValue<T extends string>(
  value: string,
  allowed: readonly T[],
  fieldName: string
): asserts value is T {
  if (!isAllowedValue(value, allowed)) {
    throw new ValidationError(
      `Invalid ${fieldName}. Allowed: ${allowed.join(", ")}`
    );
  }
}

/** Typed validation error so route handlers can catch it. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Phase 4 additions ────────────────────────────────────────

/**
 * Permission key must be lowercase dot notation (a-z, 0-9, underscore, dot)
 * and must contain at least one dot.
 */
const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidPermissionKey(value: string): boolean {
  return PERMISSION_KEY_RE.test(value);
}

/** Role scope must be global, app, or tenant. */
export function isValidRoleScope(value: string): boolean {
  return ["global", "app", "tenant"].includes(value);
}

/** Risk level must be low, medium, high, or blocked. */
export function isValidRiskLevel(value: string): boolean {
  return ["low", "medium", "high", "blocked"].includes(value);
}

/** Permission effect must be allow or deny. */
export function isValidPermissionEffect(value: string): boolean {
  return ["allow", "deny"].includes(value);
}

// ── Phase 5 additions ────────────────────────────────────────

/**
 * client_id must be lowercase snake_case (letters, digits, underscores).
 * Same rules as app_id and role_key.
 */
const CLIENT_ID_RE = /^[a-z][a-z0-9_]*$/;

export function isValidClientId(value: string): boolean {
  return CLIENT_ID_RE.test(value);
}

/** Scope must be a non-empty string. */
export function isValidScope(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Access token TTL must be between 1 and 3600 seconds. */
export function isValidJwtTtl(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 3600;
}

/** Service client status must be active | suspended | revoked | archived. */
export function isValidServiceClientStatus(value: string): boolean {
  return ["active", "suspended", "revoked", "archived"].includes(value);
}

/** Service API key status must be active | revoked | expired. */
export function isValidServiceApiKeyStatus(value: string): boolean {
  return ["active", "revoked", "expired"].includes(value);
}

/**
 * Parse a Bearer token from an Authorization header value.
 * Returns the raw token string or null if not present/invalid.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Parse a service API key from an x-ids-service-key header value.
 * Returns the raw key or null if not present.
 */
export function parseServiceApiKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a bootstrap key from an x-ids-bootstrap-key header value.
 * Returns the raw key or null if not present.
 */
export function parseBootstrapKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Phase 4B additions ───────────────────────────────────────

/** Phone verification channel must be sms, call, or whatsapp. */
export function isValidPhoneVerificationChannel(value: string): boolean {
  return ["sms", "call", "whatsapp"].includes(value);
}

/** Verification event status. */
export function isValidVerificationStatus(value: string): boolean {
  return [
    "pending",
    "approved",
    "rejected",
    "failed",
    "expired",
    "canceled",
    "max_attempts_reached",
  ].includes(value);
}

/**
 * Basic E.164-style phone check.
 * Accepts common formats: +15555555555, 15555555555, (555) 555-5555, etc.
 * Rejects obviously invalid strings (too short, letters, etc.).
 */
export function isLikelyE164Phone(value: string): boolean {
  // Strip common formatting
  const stripped = value.replace(/[\s\-\(\)\.]/g, "");
  // Must be mostly digits, optionally starting with +
  if (!/^\+?\d{7,15}$/.test(stripped)) return false;
  return true;
}

/**
 * Normalize a phone number to E.164-style format (with + prefix).
 * Uses the raw input and ensures + prefix for Twilio API calls.
 */
export function normalizePhoneE164(phone: string): string {
  const stripped = phone.replace(/[\s\-\(\)\.]/g, "").trim();
  if (stripped.startsWith("+")) return stripped;
  return `+${stripped}`;
}

/** Require a non-empty code string. */
export function requireCode(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError("A valid verification code is required.");
  }
  return value.trim();
}
