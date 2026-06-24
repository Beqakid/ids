// ── Permission Status ────────────────────────────────────────

export type PermissionStatus = "active" | "suspended" | "archived";

export const PERMISSION_STATUSES: readonly PermissionStatus[] = [
  "active",
  "suspended",
  "archived",
] as const;

// ── Permission Risk Level ────────────────────────────────────

export type PermissionRiskLevel = "low" | "medium" | "high" | "blocked";

export const PERMISSION_RISK_LEVELS: readonly PermissionRiskLevel[] = [
  "low",
  "medium",
  "high",
  "blocked",
] as const;

// ── Permission Check Source ──────────────────────────────────

export type PermissionCheckSource =
  | "internal_api"
  | "kai_future"
  | "app_future"
  | "admin_future"
  | "test";

export const PERMISSION_CHECK_SOURCES: readonly PermissionCheckSource[] = [
  "internal_api",
  "kai_future",
  "app_future",
  "admin_future",
  "test",
] as const;

// ── Permission Effect (overrides) ────────────────────────────

export type PermissionEffect = "allow" | "deny";

export const PERMISSION_EFFECTS: readonly PermissionEffect[] = [
  "allow",
  "deny",
] as const;

// ── Permission ───────────────────────────────────────────────

export interface IdsPermission {
  id: string;
  permissionKey: string;
  name: string;
  description: string | null;
  category: string | null;
  appId: string | null;
  riskLevel: PermissionRiskLevel;
  status: PermissionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Row shape as stored in D1 */
export interface IdsPermissionRow {
  id: string;
  permission_key: string;
  name: string;
  description: string | null;
  category: string | null;
  app_id: string | null;
  risk_level: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Permission Check ─────────────────────────────────────────

export interface IdsPermissionCheck {
  id: string;
  userId: string | null;
  appId: string;
  tenantId: string | null;
  membershipId: string | null;
  permissionKey: string;
  allowed: boolean;
  reason: string | null;
  riskLevel: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface IdsPermissionCheckRow {
  id: string;
  user_id: string | null;
  app_id: string;
  tenant_id: string | null;
  membership_id: string | null;
  permission_key: string;
  allowed: number;
  reason: string | null;
  risk_level: string | null;
  source: string | null;
  metadata: string | null;
  created_at: string;
}

// ── User Permission Override ─────────────────────────────────

export interface IdsUserPermissionOverride {
  id: string;
  userId: string;
  appId: string | null;
  tenantId: string | null;
  permissionId: string;
  effect: PermissionEffect;
  reason: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface IdsUserPermissionOverrideRow {
  id: string;
  user_id: string;
  app_id: string | null;
  tenant_id: string | null;
  permission_id: string;
  effect: string;
  reason: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
}
