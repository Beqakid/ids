// ── Membership Statuses ──────────────────────────────────────

export type MembershipStatus =
  | "invited"
  | "active"
  | "suspended"
  | "removed"
  | "declined";

export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = [
  "invited",
  "active",
  "suspended",
  "removed",
  "declined",
] as const;

// ── Membership ───────────────────────────────────────────────

export interface IdsMembership {
  id: string;
  userId: string;
  appId: string;
  tenantId: string;
  roleKey: string;
  status: MembershipStatus;
  invitedByUserId: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
}

/** Row shape as stored in D1 */
export interface IdsMembershipRow {
  id: string;
  user_id: string;
  app_id: string;
  tenant_id: string;
  role_key: string;
  status: string;
  invited_by_user_id: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}
