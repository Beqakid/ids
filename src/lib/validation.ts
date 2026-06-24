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

/** Typed validation error so route handlers can catch it. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
