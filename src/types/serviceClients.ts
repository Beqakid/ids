/**
 * Service client types for Phase 5 — service-to-service authentication.
 */

// ── Service client status ─────────────────────────────────────

export type ServiceClientStatus =
  | "active"
  | "suspended"
  | "revoked"
  | "archived";

export const SERVICE_CLIENT_STATUSES: readonly ServiceClientStatus[] = [
  "active",
  "suspended",
  "revoked",
  "archived",
] as const;

// ── Service API key status ────────────────────────────────────

export type ServiceApiKeyStatus = "active" | "revoked" | "expired";

export const SERVICE_API_KEY_STATUSES: readonly ServiceApiKeyStatus[] = [
  "active",
  "revoked",
  "expired",
] as const;

// ── Service client ────────────────────────────────────────────

export interface IdsServiceClient {
  id: string;
  clientId: string;
  name: string;
  appId: string | null;
  tenantId: string | null;
  status: ServiceClientStatus;
  scopes: string[] | null;
  allowedOrigins: string[] | null;
  allowedIps: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface IdsServiceClientRow {
  id: string;
  client_id: string;
  name: string;
  app_id: string | null;
  tenant_id: string | null;
  status: string;
  scopes: string | null;
  allowed_origins: string | null;
  allowed_ips: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  metadata: string | null;
}

// ── Service API key ───────────────────────────────────────────

export interface IdsServiceApiKey {
  id: string;
  serviceClientId: string;
  keyPrefix: string;
  /** key_hash is NEVER exposed outside the service layer. */
  status: ServiceApiKeyStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdByUserId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface IdsServiceApiKeyRow {
  id: string;
  service_client_id: string;
  key_prefix: string;
  key_hash: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_by_user_id: string | null;
  metadata: string | null;
}
