/**
 * JWT utility — HS256 signing and verification using Cloudflare Worker-compatible
 * Web Crypto API (no Node-only crypto APIs).
 *
 * TODO: Phase 6+ — add RS256/JWKS support for public-key verification by external apps.
 */

// ── Error ─────────────────────────────────────────────────────

export class JwtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "JwtError";
    this.code = code;
  }
}

// ── Encoding helpers ──────────────────────────────────────────

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  // btoa requires a binary string
  let binary = "";
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice(0, (4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Time helpers ──────────────────────────────────────────────

export function getUnixTime(): number {
  return Math.floor(Date.now() / 1000);
}

export function addSeconds(seconds: number): number {
  return getUnixTime() + seconds;
}

export function createJti(): string {
  return crypto.randomUUID();
}

// ── Signing key ───────────────────────────────────────────────

async function getSigningKey(secret: string): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ── Payload type ──────────────────────────────────────────────

export interface JwtPayload {
  /** Issuer — always "ids" for IDS-issued tokens. */
  iss?: string;
  /** Subject — user id. */
  sub?: string;
  /** Audience — app id. */
  aud?: string;
  /** Session id (custom claim). */
  sid?: string;
  /** App id (custom claim, mirrors aud for clarity). */
  app_id?: string;
  /** Tenant id (custom claim, nullable). */
  tenant_id?: string | null;
  /** Role keys (Phase 4 — included when available). */
  roles?: string[];
  /** Permission keys (Phase 4 — included when available). */
  permissions?: string[];
  /** JWT ID — unique token identifier used for revocation checks. */
  jti?: string;
  /** Issued at (Unix seconds). */
  iat?: number;
  /** Not before (Unix seconds). */
  nbf?: number;
  /** Expiry (Unix seconds). */
  exp?: number;
  /** Token type: "access". */
  typ?: string;
  [key: string]: unknown;
}

export interface SignJwtOptions {
  /** Lifetime in seconds. Default: 900 (15 min). Max: 3600 (1 hr). */
  expiresIn?: number;
  /** Seconds from now before the token is valid. Default: 0. */
  notBefore?: number;
}

// ── Sign ──────────────────────────────────────────────────────

/**
 * Sign a JWT using HS256.
 * Never expose the secret. Returns the compact serialization.
 */
export async function signJwt(
  payload: JwtPayload,
  secret: string,
  options: SignJwtOptions = {}
): Promise<string> {
  const now = getUnixTime();
  const expiresIn = Math.min(options.expiresIn ?? 900, 3600); // max 1 hr in Phase 5

  const header = { alg: "HS256", typ: "JWT" };
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    nbf:
      options.notBefore !== undefined ? now + options.notBefore : now,
    exp: now + expiresIn,
    jti: payload.jti ?? createJti(),
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await getSigningKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );
  const signature = base64UrlEncode(new Uint8Array(signatureBuffer));

  return `${signingInput}.${signature}`;
}

// ── Verify ────────────────────────────────────────────────────

export interface VerifyJwtOptions {
  /** Expected issuer (optional — reject if mismatch). */
  issuer?: string;
  /** Expected audience (optional — reject if mismatch). */
  audience?: string;
}

export interface VerifiedJwt {
  header: { alg: string; typ: string; [k: string]: unknown };
  payload: JwtPayload;
}

/**
 * Verify a JWT signature and validate standard claims.
 * Throws JwtError with a code on any failure.
 * Never log the raw token or the secret.
 */
export async function verifyJwt(
  token: string,
  secret: string,
  options: VerifyJwtOptions = {}
): Promise<VerifiedJwt> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new JwtError("MALFORMED_TOKEN", "Token is malformed.");
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  // ── Verify signature ────────────────────────────────────
  const key = await getSigningKey(secret);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(signature);
  } catch {
    throw new JwtError("MALFORMED_TOKEN", "Token signature encoding is invalid.");
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(signingInput)
  );
  if (!valid) {
    throw new JwtError("INVALID_SIGNATURE", "Token signature is invalid.");
  }

  // ── Decode header ────────────────────────────────────────
  let header: { alg: string; typ: string; [k: string]: unknown };
  try {
    header = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedHeader))
    );
  } catch {
    throw new JwtError("MALFORMED_TOKEN", "Token header is malformed.");
  }

  // Reject unsupported algorithm
  if (header.alg !== "HS256") {
    throw new JwtError(
      "INVALID_ALGORITHM",
      "Only HS256 algorithm is supported."
    );
  }

  // ── Decode payload ───────────────────────────────────────
  let payload: JwtPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(encodedPayload))
    );
  } catch {
    throw new JwtError("MALFORMED_TOKEN", "Token payload is malformed.");
  }

  const now = getUnixTime();

  // Require exp
  if (payload.exp === undefined || payload.exp === null) {
    throw new JwtError("MISSING_EXPIRY", "Token has no expiry claim.");
  }

  // Check expiry
  if (payload.exp < now) {
    throw new JwtError("TOKEN_EXPIRED", "Token has expired.");
  }

  // Check not-before
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw new JwtError("TOKEN_NOT_YET_VALID", "Token is not yet valid.");
  }

  // Check issuer
  if (options.issuer && payload.iss !== options.issuer) {
    throw new JwtError("INVALID_ISSUER", "Token issuer is invalid.");
  }

  // Check audience
  if (options.audience && payload.aud !== options.audience) {
    throw new JwtError("INVALID_AUDIENCE", "Token audience is invalid.");
  }

  return { header, payload };
}

// ── Decode without verification ───────────────────────────────

/**
 * Decode a JWT payload without verifying the signature.
 * USE ONLY for logging/debugging — never trust these claims for authorization.
 */
export function decodeJwtUnsafe(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(
      new TextDecoder().decode(base64UrlDecode(parts[1]))
    ) as JwtPayload;
  } catch {
    return null;
  }
}
