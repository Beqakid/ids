import { Hono } from "hono";
import { requireServiceAuth } from "../middleware/auth";
import type { HonoEnv } from "../types/env";
import { success, error } from "../lib/response";
import { requireString, ValidationError } from "../lib/validation";
import {
  createSession,
  revokeSession,
} from "../services/sessions";
import { getUserById } from "../services/users";

const internalSessions = new Hono<HonoEnv>();

// Phase 5: protect all routes in this group with service/user auth.
// TODO: Phase 6 — add permission-level checks (ids.users.read etc.) per route.
internalSessions.use("*", requireServiceAuth());

// ── POST /api/internal/sessions ──────────────────────────────
// TODO: Phase 3/4 — protect with API key or service token.
internalSessions.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const userId = requireString(body.userId, "userId");
    const appId = body.appId ?? null;
    const ttlSeconds = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600;

    // Verify user exists
    const user = await getUserById(c.env, userId);
    if (!user) {
      return error(c, "USER_NOT_FOUND", "User not found.", 404);
    }

    const result = await createSession(c.env, {
      userId,
      appId,
      ttlSeconds,
    });

    return success(
      c,
      {
        session: {
          id: result.session.id,
          userId: result.session.userId,
          appId: result.session.appId,
          status: result.session.status,
          createdAt: result.session.createdAt,
          expiresAt: result.session.expiresAt,
        },
        // Raw token returned ONLY on creation — never again.
        token: result.rawToken,
      },
      201
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return error(c, "VALIDATION_ERROR", err.message, 400);
    }
    throw err;
  }
});

// ── POST /api/internal/sessions/:id/revoke ───────────────────
internalSessions.post("/:id/revoke", async (c) => {
  const sessionId = c.req.param("id");
  const session = await revokeSession(c.env, sessionId);

  if (!session) {
    return error(c, "SESSION_NOT_FOUND", "Session not found.", 404);
  }

  return success(c, {
    session: {
      id: session.id,
      userId: session.userId,
      status: session.status,
      revokedAt: session.revokedAt,
    },
  });
});

export default internalSessions;
