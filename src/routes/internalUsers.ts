import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import {
  requireString,
  optionalString,
  isValidEmail,
  isAllowedValue,
  parseLimitOffset,
  ValidationError,
} from "../lib/validation";
import { USER_STATUSES, type UserStatus } from "../types/identity";
import {
  createUser,
  getUserById,
  listUsers,
  updateUserStatus,
  DuplicateEmailError,
} from "../services/users";
import {
  listSessionsForUser,
  revokeAllSessionsForUser,
} from "../services/sessions";

const internalUsers = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalUsers.use("*", requireServiceAuth());

// ── POST /api/internal/users ─────────────────────────────────
// TODO: Phase 3/4 — protect with API key or service token.
internalUsers.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const displayName = optionalString(body.displayName);
    const email = optionalString(body.email);
    const phone = optionalString(body.phone);

    if (email && !isValidEmail(email)) {
      return error(c, "INVALID_EMAIL", "Provided email format is invalid.", 400);
    }

    const user = await createUser(c.env, { displayName, email, phone });

    return success(
      c,
      {
        user: {
          id: user.id,
          displayName: user.displayName,
          primaryEmail: user.primaryEmail,
          primaryPhone: user.primaryPhone,
          status: user.status,
          emailVerified: user.emailVerified,
          phoneVerified: user.phoneVerified,
          createdAt: user.createdAt,
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return error(c, "DUPLICATE_EMAIL", err.message, 400);
    }
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/internal/users ──────────────────────────────────
internalUsers.get("/", async (c) => {
  const { limit, offset } = parseLimitOffset(
    c.req.query("limit"),
    c.req.query("offset")
  );
  const status = c.req.query("status");
  const email = c.req.query("email");

  if (status && !isAllowedValue(status, USER_STATUSES)) {
    return error(c, "INVALID_STATUS", `Invalid status filter: ${status}`, 400);
  }

  const result = await listUsers(c.env, { limit, offset, status, email });

  return success(c, {
    users: result.users.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      primaryEmail: u.primaryEmail,
      status: u.status,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
    })),
    total: result.total,
    limit,
    offset,
  });
});

// ── GET /api/internal/users/:id ──────────────────────────────
internalUsers.get("/:id", async (c) => {
  const userId = c.req.param("id");
  const user = await getUserById(c.env, userId);

  if (!user) {
    return error(c, "USER_NOT_FOUND", "User not found.", 404);
  }

  return success(c, {
    user: {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      primaryEmail: user.primaryEmail,
      primaryPhone: user.primaryPhone,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
    },
  });
});

// ── PATCH /api/internal/users/:id/status ─────────────────────
internalUsers.patch("/:id/status", async (c) => {
  try {
    const body = await c.req.json();
    const status = requireString(body.status, "status");

    if (!isAllowedValue(status, USER_STATUSES)) {
      return error(
        c,
        "INVALID_STATUS",
        `Invalid status. Allowed: ${USER_STATUSES.join(", ")}`,
        400
      );
    }

    const user = await updateUserStatus(c.env, c.req.param("id"), status as UserStatus);

    if (!user) {
      return error(c, "USER_NOT_FOUND", "User not found.", 404);
    }

    // Revoke active sessions for suspended/blocked/deleted users
    const revokeStatuses: UserStatus[] = ["suspended", "blocked", "deleted"];
    let sessionsRevoked = 0;
    if (revokeStatuses.includes(status as UserStatus)) {
      sessionsRevoked = await revokeAllSessionsForUser(c.env, user.id);
    }

    return success(c, {
      user: {
        id: user.id,
        displayName: user.displayName,
        status: user.status,
        updatedAt: user.updatedAt,
      },
      sessionsRevoked,
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── GET /api/internal/users/:id/sessions ─────────────────────
internalUsers.get("/:id/sessions", async (c) => {
  const userId = c.req.param("id");
  const user = await getUserById(c.env, userId);
  if (!user) {
    return error(c, "USER_NOT_FOUND", "User not found.", 404);
  }

  const sessions = await listSessionsForUser(c.env, userId);

  // Never return session_token_hash
  return success(c, {
    sessions: sessions.map((s) => ({
      id: s.id,
      userId: s.userId,
      appId: s.appId,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      lastSeenAt: s.lastSeenAt,
    })),
  });
});

// ── POST /api/internal/users/:id/sessions/revoke-all ─────────
internalUsers.post("/:id/sessions/revoke-all", async (c) => {
  const userId = c.req.param("id");
  const user = await getUserById(c.env, userId);
  if (!user) {
    return error(c, "USER_NOT_FOUND", "User not found.", 404);
  }

  const count = await revokeAllSessionsForUser(c.env, userId);

  return success(c, {
    userId,
    sessionsRevoked: count,
  });
});

export default internalUsers;
