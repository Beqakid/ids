/**
 * Platform Context Types — Phase 6
 */

export type RequesterType =
  | "command_center"
  | "kai"
  | "service"
  | "internal"
  | "test";

export type PlatformContextType =
  | "platform_summary"
  | "user_app_context"
  | "kai_action_context"
  | "app_access_summary"
  | "tenant_access_summary";

// ── Safe user summary ─────────────────────────────────────────

export interface SafeUserSummary {
  id: string;
  displayName: string | null;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

// ── App access entry ──────────────────────────────────────────

export interface UserAppAccessEntry {
  appId: string;
  name: string;
  status: string;
  roles: string[];
  tenantCount: number;
}

// ── Tenant access entry ───────────────────────────────────────

export interface UserTenantAccessEntry {
  tenantId: string;
  appId: string;
  tenantKey: string;
  name: string;
  status: string;
  roles: string[];
}

// ── Trust signals ─────────────────────────────────────────────

export interface TrustSignals {
  emailVerified: boolean;
  phoneVerified: boolean;
  activeSessions: number;
  hasActiveMemberships: boolean;
}

// ── Platform summary ──────────────────────────────────────────

export interface UserPlatformSummary {
  user: SafeUserSummary;
  apps: UserAppAccessEntry[];
  trustSignals: TrustSignals;
}

// ── User app context ──────────────────────────────────────────

export interface UserAppContext {
  user: SafeUserSummary;
  app: {
    appId: string;
    name: string;
    status: string;
  };
  tenant: {
    tenantId: string;
    tenantKey: string;
    name: string;
    status: string;
  } | null;
  membership: {
    membershipId: string;
    roleKey: string;
    status: string;
    joinedAt: string | null;
  } | null;
  roles: string[];
  effectivePermissions: string[];
  trustSignals: TrustSignals;
}

// ── Platform context request row ──────────────────────────────

export interface IdsPlatformContextRequest {
  id: string;
  requesterType: RequesterType;
  requesterClientId: string | null;
  requesterAppId: string | null;
  userId: string | null;
  targetAppId: string | null;
  targetTenantId: string | null;
  contextType: PlatformContextType;
  success: boolean;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface IdsPlatformContextRequestRow {
  id: string;
  requester_type: string;
  requester_client_id: string | null;
  requester_app_id: string | null;
  user_id: string | null;
  target_app_id: string | null;
  target_tenant_id: string | null;
  context_type: string;
  success: number;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: string | null;
  created_at: string;
}

// ── Write platform context request input ──────────────────────

export interface WritePlatformContextRequestInput {
  requesterType: RequesterType;
  requesterClientId?: string | null;
  requesterAppId?: string | null;
  userId?: string | null;
  targetAppId?: string | null;
  targetTenantId?: string | null;
  contextType: PlatformContextType;
  success: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}
