// ── Tenant Types ─────────────────────────────────────────────

export type TenantType =
  | "platform"
  | "business"
  | "store"
  | "care_team"
  | "project"
  | "organization"
  | "workspace"
  | "reviewer_group"
  | "media_space";

export const TENANT_TYPES: readonly TenantType[] = [
  "platform",
  "business",
  "store",
  "care_team",
  "project",
  "organization",
  "workspace",
  "reviewer_group",
  "media_space",
] as const;

// ── Tenant Statuses ──────────────────────────────────────────

export type TenantStatus =
  | "active"
  | "pending"
  | "suspended"
  | "archived"
  | "deleted";

export const TENANT_STATUSES: readonly TenantStatus[] = [
  "active",
  "pending",
  "suspended",
  "archived",
  "deleted",
] as const;

// ── Tenant ───────────────────────────────────────────────────

export interface IdsTenant {
  id: string;
  appId: string;
  tenantKey: string;
  name: string;
  tenantType: TenantType;
  status: TenantStatus;
  ownerUserId: string | null;
  domain: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** Row shape as stored in D1 */
export interface IdsTenantRow {
  id: string;
  app_id: string;
  tenant_key: string;
  name: string;
  tenant_type: string;
  status: string;
  owner_user_id: string | null;
  domain: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
