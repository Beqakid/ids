// ── Role Scope ───────────────────────────────────────────────

export type RoleScope = "global" | "app" | "tenant";

export const ROLE_SCOPES: readonly RoleScope[] = [
  "global",
  "app",
  "tenant",
] as const;

// ── Role Status ──────────────────────────────────────────────

export type RoleStatus = "active" | "suspended" | "archived";

export const ROLE_STATUSES: readonly RoleStatus[] = [
  "active",
  "suspended",
  "archived",
] as const;

// ── Role ─────────────────────────────────────────────────────

export interface IdsRole {
  id: string;
  roleKey: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  appId: string | null;
  tenantId: string | null;
  status: RoleStatus;
  isSystemRole: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Row shape as stored in D1 */
export interface IdsRoleRow {
  id: string;
  role_key: string;
  name: string;
  description: string | null;
  scope: string;
  app_id: string | null;
  tenant_id: string | null;
  status: string;
  is_system_role: number;
  created_at: string;
  updated_at: string;
}
