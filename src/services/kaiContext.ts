/**
 * Kai Context Service — Phase 6
 *
 * Prepares action context for Kai and Command Center.
 * Does NOT execute Kai actions. Does NOT call external APIs.
 * Does NOT connect SMS assets.
 *
 * TODO: Phase 7 — Link TrustProof receipt finalization to Kai action execution.
 */

import type { Env } from "../types/env";
import type {
  IdsKaiActionContext,
  IdsKaiActionContextRow,
  PrepareKaiActionInput,
  KaiActionEvaluation,
  KaiContextPayload,
  ListKaiActionContextsOptions,
  KaiRiskLevel,
  KaiActionStatus,
} from "../types/kaiContext";
import { getDB } from "../lib/db";
import { writeAuditLog } from "./audit";
import { writeAppAccessLog } from "./appAccessLogs";
import { getUserById } from "./users";
import { getAppByIdSilent } from "./apps";
import { getTenantByIdSilent } from "./tenants";
import { writePlatformContextRequest } from "./platformContext";
import { buildTrustSignalsForUser } from "./platformContext";
import {
  getRoleKeysForUserContext,
  getPermissionsForUserContext,
  checkPermission,
} from "./permissionChecks";
import { createTrustReceiptEnvelope } from "./trustReceiptEnvelopes";
import type { WritePlatformContextRequestInput } from "../types/platformContext";

// ── Helper: row → domain model ────────────────────────────────

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObj(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToKaiActionContext(row: IdsKaiActionContextRow): IdsKaiActionContext {
  return {
    id: row.id,
    userId: row.user_id,
    appId: row.app_id,
    tenantId: row.tenant_id,
    actionKey: row.action_key,
    actionLabel: row.action_label,
    actionType: row.action_type as IdsKaiActionContext["actionType"],
    riskLevel: row.risk_level as KaiRiskLevel,
    status: row.status as KaiActionStatus,
    requiresConfirmation: row.requires_confirmation === 1,
    requiresAdminApproval: row.requires_admin_approval === 1,
    allowed: row.allowed === 1,
    deniedReason: row.denied_reason,
    permissionKey: row.permission_key,
    matchedRoles: parseJsonArray(row.matched_roles),
    matchedPermissions: parseJsonArray(row.matched_permissions),
    trustSignals: parseJsonObj(row.trust_signals),
    metadata: parseJsonObj(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

// ── Evaluate Kai action ───────────────────────────────────────

export async function evaluateKaiAction(
  input: PrepareKaiActionInput,
  env: Env
): Promise<{
  allowed: boolean;
  status: KaiActionStatus;
  requiresConfirmation: boolean;
  requiresAdminApproval: boolean;
  deniedReason: string | null;
  matchedRoles: string[];
  matchedPermissions: string[];
}> {
  const riskLevel: KaiRiskLevel = input.riskLevel ?? "low";
  const tenantId = input.tenantId ?? null;

  // 1. Blocked risk → always deny
  if (riskLevel === "blocked") {
    return {
      allowed: false,
      status: "denied",
      requiresConfirmation: false,
      requiresAdminApproval: false,
      deniedReason: "Action risk level is blocked. Permanently denied.",
      matchedRoles: [],
      matchedPermissions: [],
    };
  }

  // 2. Validate user
  const user = await getUserById(env, input.userId);
  if (!user) {
    return {
      allowed: false,
      status: "denied",
      requiresConfirmation: false,
      requiresAdminApproval: false,
      deniedReason: "User not found.",
      matchedRoles: [],
      matchedPermissions: [],
    };
  }
  if (["suspended", "blocked", "deleted"].includes(user.status)) {
    return {
      allowed: false,
      status: "denied",
      requiresConfirmation: false,
      requiresAdminApproval: false,
      deniedReason: `User is ${user.status}.`,
      matchedRoles: [],
      matchedPermissions: [],
    };
  }

  // 3. Validate app
  const app = await getAppByIdSilent(env, input.appId);
  if (!app) {
    return {
      allowed: false,
      status: "denied",
      requiresConfirmation: false,
      requiresAdminApproval: false,
      deniedReason: "App not found.",
      matchedRoles: [],
      matchedPermissions: [],
    };
  }
  if (["suspended", "deprecated", "archived"].includes(app.status)) {
    return {
      allowed: false,
      status: "denied",
      requiresConfirmation: false,
      requiresAdminApproval: false,
      deniedReason: `App is ${app.status}.`,
      matchedRoles: [],
      matchedPermissions: [],
    };
  }

  // 4. Validate tenant + membership if tenantId provided
  if (tenantId) {
    const tenant = await getTenantByIdSilent(env, tenantId);
    if (!tenant) {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: "Tenant not found.",
        matchedRoles: [],
        matchedPermissions: [],
      };
    }
    if (["suspended", "archived", "deleted"].includes(tenant.status)) {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: `Tenant is ${tenant.status}.`,
        matchedRoles: [],
        matchedPermissions: [],
      };
    }

    const db = getDB(env);
    const membership = await db
      .prepare(
        `SELECT id, status FROM ids_memberships
         WHERE user_id = ? AND app_id = ? AND tenant_id = ? LIMIT 1`
      )
      .bind(input.userId, input.appId, tenantId)
      .first<{ id: string; status: string }>();

    if (!membership) {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: "No active membership found.",
        matchedRoles: [],
        matchedPermissions: [],
      };
    }
    if (membership.status !== "active") {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: `Membership is ${membership.status}.`,
        matchedRoles: [],
        matchedPermissions: [],
      };
    }
  }

  // 5. Permission check (Phase 4) if permissionKey provided
  let matchedRoles: string[] = [];
  let matchedPermissions: string[] = [];

  if (input.permissionKey) {
    // Phase 4 permission service is available — run proper check
    const permResult = await checkPermission(env, {
      userId: input.userId,
      appId: input.appId,
      tenantId,
      permissionKey: input.permissionKey,
      source: "kai_action_context",
      metadata: { actionKey: input.actionKey, riskLevel },
    });

    if (!permResult.allowed) {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: permResult.reason,
        matchedRoles: permResult.matchedRoles,
        matchedPermissions: [],
      };
    }

    matchedRoles = permResult.matchedRoles;
    matchedPermissions = [input.permissionKey];
  } else {
    // TODO: Phase 4 permission check — when permissionKey is not provided,
    // we fall back to membership-based allow. Add full permission enforcement here.
    const roles = await getRoleKeysForUserContext(
      env,
      input.userId,
      input.appId,
      tenantId
    );
    if (tenantId && roles.length === 0) {
      return {
        allowed: false,
        status: "denied",
        requiresConfirmation: false,
        requiresAdminApproval: false,
        deniedReason: "No roles found for user in this context.",
        matchedRoles: [],
        matchedPermissions: [],
      };
    }
    matchedRoles = roles;
    matchedPermissions = await getPermissionsForUserContext(
      env,
      input.userId,
      input.appId,
      tenantId
    );
  }

  // 6. Determine final status based on risk level
  if (riskLevel === "high") {
    return {
      allowed: true,
      status: "admin_approval_required",
      requiresConfirmation: false,
      requiresAdminApproval: true,
      deniedReason: null,
      matchedRoles,
      matchedPermissions,
    };
  }

  if (riskLevel === "medium") {
    return {
      allowed: true,
      status: "confirmation_required",
      requiresConfirmation: true,
      requiresAdminApproval: false,
      deniedReason: null,
      matchedRoles,
      matchedPermissions,
    };
  }

  // low risk
  return {
    allowed: true,
    status: "allowed",
    requiresConfirmation: false,
    requiresAdminApproval: false,
    deniedReason: null,
    matchedRoles,
    matchedPermissions,
  };
}

// ── Prepare Kai action context ────────────────────────────────

export async function prepareKaiActionContext(
  input: PrepareKaiActionInput,
  env: Env,
  requestContext?: { ipAddress?: string | null; userAgent?: string | null; clientId?: string | null }
): Promise<KaiActionEvaluation> {
  const db = getDB(env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const riskLevel: KaiRiskLevel = input.riskLevel ?? "low";
  const tenantId = input.tenantId ?? null;

  // Evaluate
  const evaluation = await evaluateKaiAction(input, env);

  const trustSignals = await buildTrustSignalsForUser(env, input.userId);

  // Compute expires_at: 24 hours from now
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO ids_kai_action_contexts
         (id, user_id, app_id, tenant_id, action_key, action_label, action_type,
          risk_level, status, requires_confirmation, requires_admin_approval,
          allowed, denied_reason, permission_key, matched_roles, matched_permissions,
          trust_signals, metadata, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.userId,
      input.appId,
      tenantId,
      input.actionKey,
      input.actionLabel,
      input.actionType,
      riskLevel,
      evaluation.status,
      evaluation.requiresConfirmation ? 1 : 0,
      evaluation.requiresAdminApproval ? 1 : 0,
      evaluation.allowed ? 1 : 0,
      evaluation.deniedReason,
      input.permissionKey ?? null,
      JSON.stringify(evaluation.matchedRoles),
      JSON.stringify(evaluation.matchedPermissions),
      JSON.stringify(trustSignals),
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
      expiresAt
    )
    .run();

  // Write audit log
  const auditEvent = evaluation.allowed
    ? "kai_action_context_prepared"
    : "kai_action_context_denied";

  await writeAuditLog(env, {
    eventType: auditEvent,
    userId: input.userId,
    appId: input.appId,
    tenantId,
    metadata: {
      actionContextId: id,
      actionKey: input.actionKey,
      riskLevel,
      status: evaluation.status,
      allowed: evaluation.allowed,
      deniedReason: evaluation.deniedReason,
    },
  });

  // Write platform context request log
  await writePlatformContextRequest(env, {
    requesterType: "kai",
    requesterClientId: requestContext?.clientId,
    userId: input.userId,
    targetAppId: input.appId,
    targetTenantId: tenantId,
    contextType: "kai_action_context",
    success: true,
    ipAddress: requestContext?.ipAddress,
    userAgent: requestContext?.userAgent,
    metadata: { actionContextId: id, actionKey: input.actionKey },
  } as WritePlatformContextRequestInput);

  // Write app access log
  await writeAppAccessLog(env, {
    appId: input.appId,
    userId: input.userId,
    tenantId: tenantId ?? undefined,
    eventType: "app_access_checked",
    allowed: evaluation.allowed,
    reason: evaluation.deniedReason ?? evaluation.status,
    metadata: {
      action: "kai_action_context_prepared",
      actionContextId: id,
      actionKey: input.actionKey,
    },
  });

  // Create a draft trust receipt envelope for allowed or confirmation-required actions
  let receiptEnvelopeId: string | null = null;
  if (evaluation.allowed || evaluation.status === "confirmation_required" || evaluation.status === "admin_approval_required") {
    try {
      const receiptResult = await createTrustReceiptEnvelope(
        {
          receiptType: "kai_action",
          sourceAppId: input.appId,
          sourceTenantId: tenantId,
          userId: input.userId,
          actionContextId: id,
          riskLevel,
          actionKey: input.actionKey,
          summary: `Kai prepared a ${riskLevel}-risk ${input.actionType} action: ${input.actionLabel}`,
        },
        env
      );
      receiptEnvelopeId = receiptResult.id;
    } catch {
      // Non-fatal: receipt envelope creation failure doesn't block action context
    }
  }

  return {
    actionContextId: id,
    allowed: evaluation.allowed,
    status: evaluation.status,
    requiresConfirmation: evaluation.requiresConfirmation,
    requiresAdminApproval: evaluation.requiresAdminApproval,
    riskLevel,
    reason:
      evaluation.deniedReason ??
      getStatusReason(evaluation.status),
    matchedRoles: evaluation.matchedRoles,
    matchedPermissions: evaluation.matchedPermissions,
    trustSignals: trustSignals as unknown as Record<string, unknown>,
    receiptEnvelopeId,
  };
}

function getStatusReason(status: KaiActionStatus): string {
  switch (status) {
    case "allowed":
      return "Action is allowed.";
    case "confirmation_required":
      return "Action is allowed but requires confirmation.";
    case "admin_approval_required":
      return "Action requires admin approval due to high risk.";
    case "denied":
      return "Action is denied.";
    default:
      return status;
  }
}

// ── Get action context by ID ──────────────────────────────────

export async function getKaiActionContextById(
  env: Env,
  id: string
): Promise<IdsKaiActionContext | null> {
  const db = getDB(env);
  const row = await db
    .prepare("SELECT * FROM ids_kai_action_contexts WHERE id = ?")
    .bind(id)
    .first<IdsKaiActionContextRow>();
  if (!row) return null;
  return rowToKaiActionContext(row);
}

// ── List action contexts ──────────────────────────────────────

export async function listKaiActionContexts(
  env: Env,
  opts: ListKaiActionContextsOptions
): Promise<{ contexts: IdsKaiActionContext[]; total: number }> {
  const db = getDB(env);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) { conditions.push("user_id = ?"); params.push(opts.userId); }
  if (opts.appId) { conditions.push("app_id = ?"); params.push(opts.appId); }
  if (opts.tenantId) { conditions.push("tenant_id = ?"); params.push(opts.tenantId); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.riskLevel) { conditions.push("risk_level = ?"); params.push(opts.riskLevel); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ids_kai_action_contexts ${where}`)
    .bind(...params)
    .first<{ cnt: number }>();
  const total = countRow?.cnt ?? 0;

  const rows = await db
    .prepare(
      `SELECT * FROM ids_kai_action_contexts ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(...params, opts.limit, opts.offset)
    .all<IdsKaiActionContextRow>();

  return {
    contexts: (rows.results ?? []).map(rowToKaiActionContext),
    total,
  };
}

// ── Expire old Kai action contexts ────────────────────────────

export async function expireOldKaiActionContexts(env: Env): Promise<number> {
  const db = getDB(env);
  const result = await db
    .prepare(
      `UPDATE ids_kai_action_contexts
       SET status = 'expired', updated_at = datetime('now')
       WHERE status NOT IN ('expired', 'canceled', 'denied')
         AND expires_at IS NOT NULL
         AND expires_at < datetime('now')`
    )
    .run();

  return result.meta?.changes ?? 0;
}

// ── Build Kai context payload ─────────────────────────────────

export interface BuildKaiContextInput {
  userId: string;
  appId: string;
  tenantId?: string | null;
  requesterType?: WritePlatformContextRequestInput["requesterType"];
  requesterClientId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function buildKaiContextPayload(
  input: BuildKaiContextInput,
  env: Env
): Promise<KaiContextPayload> {
  const tenantId = input.tenantId ?? null;

  const [user, app, trustSignals, roles, effectivePermissions] = await Promise.all([
    getUserById(env, input.userId),
    getAppByIdSilent(env, input.appId),
    buildTrustSignalsForUser(env, input.userId),
    getRoleKeysForUserContext(env, input.userId, input.appId, tenantId),
    getPermissionsForUserContext(env, input.userId, input.appId, tenantId),
  ]);

  if (!user) {
    throw new Error("User not found.");
  }

  let tenantInfo = null;
  let membershipInfo = null;

  if (tenantId) {
    const tenant = await getTenantByIdSilent(env, tenantId);
    if (tenant) {
      tenantInfo = {
        tenantId: tenant.id,
        tenantKey: tenant.tenantKey,
        name: tenant.name,
        status: tenant.status,
      };
    }

    const db = getDB(env);
    const membership = await db
      .prepare(
        `SELECT id, role_key, status FROM ids_memberships
         WHERE user_id = ? AND app_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1`
      )
      .bind(input.userId, input.appId, tenantId)
      .first<{ id: string; role_key: string; status: string }>();

    if (membership) {
      membershipInfo = {
        membershipId: membership.id,
        roleKey: membership.role_key,
        status: membership.status,
      };
    }
  }

  // Derive allowed action hints from effective permissions
  const allowedActionHints = effectivePermissions
    .filter((p) => p.startsWith("kai."))
    .slice(0, 20);

  // Safety notes
  const safetyNotes: string[] = [];
  if (!trustSignals.phoneVerified) safetyNotes.push("User phone is not verified.");
  if (!trustSignals.emailVerified) safetyNotes.push("User email is not verified.");
  if (!trustSignals.hasActiveMemberships) {
    safetyNotes.push("User has no active memberships.");
  }
  if (user.status !== "active") {
    safetyNotes.push(`User status is ${user.status}.`);
  }

  // Write logs
  await writePlatformContextRequest(env, {
    requesterType: input.requesterType ?? "kai",
    requesterClientId: input.requesterClientId,
    userId: input.userId,
    targetAppId: input.appId,
    targetTenantId: tenantId,
    contextType: "kai_action_context",
    success: true,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  } as WritePlatformContextRequestInput);

  await writeAuditLog(env, {
    eventType: "kai_context_requested",
    userId: input.userId,
    appId: input.appId,
    tenantId,
    metadata: {
      requesterType: input.requesterType ?? "kai",
      roleCount: roles.length,
      permissionCount: effectivePermissions.length,
    },
  });

  if (input.appId) {
    await writeAppAccessLog(env, {
      appId: input.appId,
      userId: input.userId,
      tenantId: tenantId ?? undefined,
      eventType: "app_access_checked",
      allowed: true,
      metadata: { action: "kai_context_requested" },
    });
  }

  return {
    user: {
      id: user.id,
      displayName: user.displayName ?? null,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
    },
    app: app
      ? { appId: app.appId, name: app.name, status: app.status }
      : null,
    tenant: tenantInfo,
    membership: membershipInfo,
    roles,
    effectivePermissions,
    trustSignals: trustSignals as unknown as Record<string, unknown>,
    allowedActionHints,
    safetyNotes,
  };
}
