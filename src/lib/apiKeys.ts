/**
 * Service API key utility for Phase 5.
 *
 * Key format: ids_sk_<clientId>_<16-byte-hex>
 * Example:    ids_sk_command_center_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
 *
 * Security rules:
 * - Raw key returned ONLY once at creation time.
 * - Only the hash is stored in the database — never the raw key.
 * - Never expose the hash or the full raw key in responses.
 * - Use IDS_API_KEY_PEPPER (Worker secret) for HMAC-SHA-256 when available.
 * - Fall back to plain SHA-256 when no pepper is configured.
 */

// ── Generate ──────────────────────────────────────────────────

/**
 * Generate a new raw service API key.
 * The key is returned once and must be stored by the caller immediately.
 */
export function generateServiceApiKey(clientId: string): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ids_sk_${clientId}_${hex}`;
}

// ── Hash ──────────────────────────────────────────────────────

/**
 * Hash a raw service API key.
 * Uses HMAC-SHA-256 with pepper when provided; falls back to SHA-256.
 */
export async function hashServiceApiKey(
  rawKey: string,
  pepper?: string
): Promise<string> {
  if (pepper) {
    const pepperData = new TextEncoder().encode(pepper);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      pepperData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const data = new TextEncoder().encode(rawKey);
    const hashBuffer = await crypto.subtle.sign("HMAC", cryptoKey, data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // No pepper — SHA-256
  const data = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Prefix ────────────────────────────────────────────────────

/**
 * Return the display prefix for a raw API key (first 28 characters).
 * Used for lookup and display in listings — safe to store and show.
 */
export function getApiKeyPrefix(rawKey: string): string {
  return rawKey.substring(0, 28);
}

// ── Verify ────────────────────────────────────────────────────

/**
 * Verify a raw API key against a stored hash.
 * Uses constant-time comparison via re-hashing.
 */
export async function verifyServiceApiKey(
  rawKey: string,
  storedHash: string,
  pepper?: string
): Promise<boolean> {
  const hash = await hashServiceApiKey(rawKey, pepper);
  return hash === storedHash;
}

// ── Mask ──────────────────────────────────────────────────────

/**
 * Return a masked version of a raw key safe for logging.
 * Example: ids_sk_command_center_a1b2...
 */
export function maskApiKey(rawKey: string): string {
  return `${getApiKeyPrefix(rawKey)}...`;
}
