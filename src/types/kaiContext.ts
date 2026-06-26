/**
 * Kai Context Types — Phase 6
 */

export type KaiActionType =
  | "explain"
  | "draft"
  | "prepare"
  | "dispatch"
  | "update"
  | "delete"
  | "verify"
  | "review"
  | "approve"
  | "reject"
  | "system";

export type KaiRiskLevel = "low" | "medium" | "high" | "blocked";

export type KaiActionStatus =
  | "prepared"
  | "confirmation_required"
  | "admin_approval_required"
  | "allowed"
  | "denied"
  | "expired"
  | "canceled";

// ── DB row ────────────────────────────────────────────────────

export interface IdsKaiActionContextRow {
  id: string;
  user_id: string;
  app_id: string;
  tenant_id: string | null;
  action_key: string;
  action_label: string;
  action_type: string;
  risk_level: string;
  status: string;
  requires_confirmation: number;
  requires_admin_approval: number;
  allowed: number;
  denied_reason: string | null;
  permission_key: string | null;
  matched_roles: string | null;
  matched_permissions: string | null;
  trust_signals: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

// ── Domain model ──────────────────────────────────────────────

export interface IdsKaiActionContext {
  id: string;
  userId: string;
  appId: string;
  tenantId: string | null;
  actionKey: string;
  actionLabel: string;
  actionType: KaiActionType;
  riskLevel: KaiRiskLevel;
  status: KaiActionStatus;
  requiresConfirmation: boolean;
  requiresAdminApproval: boolean;
  allowed: boolean;
  deniedReason: string | null;
  permissionKey: string | null;
  matchedRoles: string[];
  matchedPermissions: string[];
  trustSignals: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

// ── Prepare input ─────────────────────────────────────────────

export interface PrepareKaiActionInput {
  userId: string;
  appId: string;
  tenantId?: string | null;
  actionKey: string;
  actionLabel: string;
  actionType: KaiActionType;
  riskLevel?: KaiRiskLevel;
  permissionKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ── Evaluation result ─────────────────────────────────────────

export interface KaiActionEvaluation {
  actionContextId: string;
  allowed: boolean;
  status: KaiActionStatus;
  requiresConfirmation: boolean;
  requiresAdminApproval: boolean;
  riskLevel: KaiRiskLevel;
  reason: string;
  matchedRoles: string[];
  matchedPermissions: string[];
  trustSignals: Record<string, unknown>;
  receiptEnvelopeId: string | null;
}

// ── Kai context payload ───────────────────────────────────────

export interface KaiContextPayload {
  user: {
    id: string;
    displayName: string | null;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  app: {
    appId: string;
    name: string;
    status: string;
  } | null;
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
  } | null;
  roles: string[];
  effectivePermissions: string[];
  trustSignals: Record<string, unknown>;
  allowedActionHints: string[];
  safetyNotes: string[];
}

// ── List options ──────────────────────────────────────────────

export interface ListKaiActionContextsOptions {
  limit: number;
  offset: number;
  userId?: string;
  appId?: string;
  tenantId?: string;
  status?: string;
  riskLevel?: string;
}
