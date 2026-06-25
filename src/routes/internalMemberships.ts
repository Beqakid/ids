import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidRoleKey,
  isAllowedValue,
  parseJsonMetadata,
  ValidationError,
} from "../lib/validation";
import {
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from "../types/memberships";
import {
  createMembership,
  getMembershipById,
  listMembershipsForUser,
  listMembershipsForTenant,
  listMembershipsForApp,
  updateMembershipStatus,
  removeMembership,
  getUserTenantContext,
  DuplicateMembershipError,
} from "../services/memberships";

const internalMemberships = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalMemberships.use("*", requireServiceAuth());

// ── POST /api/internal/memberships ───────────────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalMemberships.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const userId = requireString(body.userId, "userId");
    const appId = requireString(body.appId, "appId");
    const tenantId = requireString(body.tenantId, "tenantId");
    const roleKey = requireString(body.roleKey, "roleKey").toLowerCase();
    const status = optionalString(body.status);
    const invitedByUserId = optionalString(body.invitedByUserId);
    const metadata = parseJsonMetadata(body.metadata);

    if (!isValidRoleKey(roleKey)) {
      return error(
        c,
        "INVALID_ROLE_KEY",
        "roleKey must be lowercase snake_case (letters, digits, underscores).",
        400
      );
    }

    if (status && !isAllowedValue(status, MEMBERSHIP_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${MEMBERSHIP_STATUSES.join(", ")}`,
        400
      );
    }

    const membership = await createMembership(c.env, {
      userId,
      appId,
      tenantId,
      roleKey,
      status: status as MembershipStatus | undefined,
      invitedByUserId,
      metadata,
    });

    return success(
      c,
      {
        membership: {
          id: membership.id,
          userId: membership.userId,
          appId: membership.appId,
          tenantId: membership.tenantId,
          roleKey: membership.roleKey,
          status: membership.status,
          invitedByUserId: membership.invitedByUserId,
          joinedAt: membership.joinedAt,
          createdAt: membership.createdAt,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof DuplicateMembershipError) {
      return error(c, "DUPLICATE_MEMBERSHIP", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── PATCH /api/internal/memberships/:id/status ───────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalMemberships.patch("/:id/status", async (c) => {
  try {
    const membershipId = c.req.param("id");
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, MEMBERSHIP_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${MEMBERSHIP_STATUSES.join(", ")}`,
        400
      );
    }

    const membership = await updateMembershipStatus(
      c.env,
      membershipId,
      status as MembershipStatus
    );

    if (!membership) {
      return error(c, "MEMBERSHIP_NOT_FOUND", "Membership not found.", 404);
    }

    return success(c, {
      membership: {
        id: membership.id,
        userId: membership.userId,
        appId: membership.appId,
        tenantId: membership.tenantId,
        roleKey: membership.roleKey,
        status: membership.status,
        updatedAt: membership.updatedAt,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/internal/memberships/:id/remove ────────────────
// TODO: Phase 4/5 — protect with API key or service token.
internalMemberships.post("/:id/remove", async (c) => {
  const membershipId = c.req.param("id");
  const membership = await removeMembership(c.env, membershipId);

  if (!membership) {
    return error(c, "MEMBERSHIP_NOT_FOUND", "Membership not found.", 404);
  }

  return success(c, {
    membership: {
      id: membership.id,
      userId: membership.userId,
      appId: membership.appId,
      tenantId: membership.tenantId,
      roleKey: membership.roleKey,
      status: membership.status,
      updatedAt: membership.updatedAt,
    },
  });
});

export default internalMemberships;
